import { createHash } from 'node:crypto';
import { terminalTargetKey, workspaceTerminalTarget, type TerminalTarget, type Workspace } from '@ssh-server/shared';
import { workspaceTarget, type ResolvedConnection } from '../ssh/connection';
import type { SshPool } from '../ssh/pool';
import type { WorkspaceStore } from '../workspaces/store';

export class ResourceTargetError extends Error {
  constructor(readonly code: 'workspace_missing' | 'target_changed') {
    super(code === 'workspace_missing' ? '工作区不存在' : '工作区连接或目录已变化，请关闭资源面板后重新打开');
  }
}

export type ResourceTargetContext = {
  target: TerminalTarget;
  workspace: Workspace;
  key: string;
  samplingKey: string;
  generation: number;
};
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
/** pool 的 cacheKey 保留 alias；资源按实际目标与认证共享，摘要只留在后端。 */
function samplingKey(connection: ResolvedConnection): string {
  const auth = connection.authMode === 'key' ? connection.privateKey : connection.password;
  return digest(
    JSON.stringify([
      connection.hostname,
      connection.port,
      connection.username,
      connection.authMode,
      digest(auth ?? ''),
      digest(connection.knownHosts),
    ]),
  );
}

/** 资源与作业查询共用：每次异步解析前后都复查固定目标、实际 key 及认证代次。 */
export function createResourceTargetContext({ store, pool }: { store: Pick<WorkspaceStore, 'get'>; pool: SshPool }) {
  async function checkedWorkspace(target: TerminalTarget) {
    const workspace = await store.get(target.workspaceId);
    if (!workspace) throw new ResourceTargetError('workspace_missing');
    if (terminalTargetKey(workspaceTerminalTarget(workspace)) !== terminalTargetKey(target))
      throw new ResourceTargetError('target_changed');
    return workspace;
  }
  function checkGeneration(alias: string, expected: number) {
    if (pool.generation(alias) !== expected) throw new ResourceTargetError('target_changed');
  }
  return async (input: TerminalTarget, expected?: ResourceTargetContext): Promise<ResourceTargetContext> => {
    const target = { ...input };
    if (expected && terminalTargetKey(expected.target) !== terminalTargetKey(target))
      throw new ResourceTargetError('target_changed');
    const generation = pool.generation(target.sshHost);
    if (expected) checkGeneration(target.sshHost, expected.generation);
    const workspace = await checkedWorkspace(target);
    checkGeneration(target.sshHost, generation);
    const connection = await pool.resolveConnection(workspaceTarget(workspace)).catch((error: unknown) => {
      checkGeneration(target.sshHost, generation);
      throw error;
    });
    // 连接解析会异步读取配置/凭据，不能继续使用解析前的工作区事实。
    const current = await checkedWorkspace(target);
    checkGeneration(target.sshHost, generation);
    const context = {
      target,
      workspace: current,
      key: connection.cacheKey,
      samplingKey: samplingKey(connection),
      generation,
    };
    if (expected && (context.key !== expected.key || context.samplingKey !== expected.samplingKey))
      throw new ResourceTargetError('target_changed');
    return context;
  };
}
