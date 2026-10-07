import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  SyncSettingsSchema,
  WorkspaceSetupInputSchema,
  type WorkspaceInput,
  type WorkspaceSetupVerification,
  type WorkspaceSetupCreate,
  type WorkspaceSetupResult,
} from '@ssh-server/shared';
import type { SshPool } from '../../ssh/pool';
import type { SyncManager } from '../../sync/manager';
import { workspaceTarget } from '../../ssh/connection';
import { remoteOperation } from '../../remote-files/operation';
import type { WorkspaceStore } from '../store';
import { inspectLocalRoot } from './local';
import { inspectRemoteRoot } from './remote';
import { WorkspaceSetupError } from './errors';

type Checked = {
  input: WorkspaceInput;
  signature: string;
  key: string;
  generation: number;
  authMode: WorkspaceSetupVerification['target']['authMode'];
  local: Awaited<ReturnType<typeof inspectLocalRoot>>;
  remote: WorkspaceSetupVerification['remote'];
};
type Ticket = { checked: Checked; expiresAt: number };
type Deps = {
  pool: SshPool;
  store: WorkspaceStore;
  sync: Pick<SyncManager, 'initialize' | 'status'>;
  inspectLocal?: typeof inspectLocalRoot;
  inspectRemote?: typeof inspectRemoteRoot;
  acquireWorkspace?: (id: string) => () => void;
};
export function normalizeSetupInput(input: WorkspaceInput): WorkspaceInput {
  const parsed = WorkspaceSetupInputSchema.parse(input);
  return {
    ...parsed,
    localDir: path.resolve(parsed.localDir),
    sync: SyncSettingsSchema.parse(parsed.sync ?? {}),
  };
}
const changed = () => new WorkspaceSetupError('setup_verification_changed', '配置、目录或认证已变化，请重新验证后创建');

export function createSetupVerification(deps: Deps) {
  const tickets = new Map<string, Ticket>();
  let pending = 0;
  const local = deps.inspectLocal ?? inspectLocalRoot;
  const remote = deps.inspectRemote ?? inspectRemoteRoot;
  function check(raw: WorkspaceInput, parent: AbortSignal): Promise<Checked> {
    // 配置读取可能不接收 signal；race 让取消/截止立即释放写盘队列，迟到检查没有保存副作用。
    return remoteOperation(parent, (signal) => inspect(raw, signal));
  }
  async function inspect(raw: WorkspaceInput, signal: AbortSignal): Promise<Checked> {
    if (!path.isAbsolute(raw.localDir))
      throw new WorkspaceSetupError('local_directory_invalid', '本地目录必须是绝对路径');
    const input = normalizeSetupInput(raw);
    const generation = deps.pool.generation(input.sshHost);
    const config = await deps.pool.resolveConnection(workspaceTarget(input));
    signal.throwIfAborted();
    const localInfo = await local(input.localDir, signal);
    const remoteInfo = await remote(deps.pool, { ...input, id: 'setup-verification' }, signal);
    const current = await deps.pool.resolveConnection(workspaceTarget(input));
    const localAfter = await local(input.localDir, signal);
    signal.throwIfAborted();
    if (
      config.cacheKey !== current.cacheKey ||
      generation !== deps.pool.generation(input.sshHost) ||
      localAfter.identity !== localInfo.identity
    )
      throw changed();
    return {
      input,
      signature: JSON.stringify(input),
      key: config.cacheKey,
      generation,
      authMode: config.authMode,
      local: localAfter,
      remote: remoteInfo,
    };
  }
  function cleanup() {
    for (const [id, ticket] of tickets) if (ticket.expiresAt <= Date.now()) tickets.delete(id);
  }
  function assertSame(current: Checked, prior: Checked) {
    if (
      current.key !== prior.key ||
      current.generation !== prior.generation ||
      current.local.identity !== prior.local.identity ||
      current.remote.path !== prior.remote.path
    )
      throw changed();
  }
  return {
    async verify(input: WorkspaceInput, signal: AbortSignal): Promise<WorkspaceSetupVerification> {
      cleanup();
      if (tickets.size + pending >= 64)
        throw new WorkspaceSetupError('setup_verification_full', '待创建验证数量已满，请稍后重试');
      pending++;
      try {
        const checked = await check(input, signal);
        const verification = randomUUID();
        const expiresAt = Date.now() + 5 * 60000;
        tickets.set(verification, { checked, expiresAt });
        return {
          verification,
          expiresAt,
          local: checked.local.info,
          remote: checked.remote,
          target: { sshHost: checked.input.sshHost, authMode: checked.authMode },
        };
      } finally {
        pending--;
      }
    },
    async create(request: WorkspaceSetupCreate, signal: AbortSignal): Promise<WorkspaceSetupResult> {
      cleanup();
      const ticket = tickets.get(request.verification);
      tickets.delete(request.verification);
      if (!ticket) throw new WorkspaceSetupError('setup_verification_expired', '验证已过期或使用，请重新验证');
      if (
        !request.initializationConfirmed ||
        ticket.checked.signature !== JSON.stringify(normalizeSetupInput(request.input))
      )
        throw changed();
      const current = await check(request.input, signal);
      const prior = ticket.checked;
      assertSame(current, prior);
      signal.throwIfAborted();
      // 保存是创建的提交点；之后初始化独立收尾，关闭网页不声称撤销文件变化。
      let release: (() => void) | undefined;
      try {
        const workspace = await deps.store.create(
          { ...current.input, localDir: current.local.info.path, remoteDir: current.remote.path },
          async (created) => {
            assertSame(await check(request.input, signal), prior);
            signal.throwIfAborted();
            release = deps.acquireWorkspace?.(created.id);
          },
        );
        let sync;
        try {
          sync = await deps.sync.initialize(workspace, true);
        } catch {
          sync = {
            ...(await deps.sync.status(workspace)),
            phase: 'error' as const,
            message: '工作区已保存，但首次同步未完成，请从同步详情检查并恢复',
          };
        }
        return { workspace, sync };
      } finally {
        release?.();
      }
    },
    revoke(verification: string) {
      tickets.delete(verification);
    },
    dispose() {
      tickets.clear();
    },
  };
}
