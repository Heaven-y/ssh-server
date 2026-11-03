import { createHash, randomUUID } from 'node:crypto';
import { type RemoteFileActionInput, type RemoteFilePreflight, type Workspace } from '@agentdeck/shared';
import type { SshPool } from '../ssh/pool';
import { workspaceTarget } from '../ssh/connection';
import type { WorkspaceStore } from '../workspaces/store';
import { workspaceKey } from './binding';
import { RemoteFilesError } from './errors';
import { RemoteActionPlanSchema, type RemoteActionPlan, type RemoteExecutor } from './executor';
import { remotePath } from './paths';
import type { RemoteFilesService } from './service';

export type FileActionContext = Omit<Awaited<ReturnType<RemoteFilesService['context']>>, 'identity'>;
export type PreparedAction = {
  public: RemoteFilePreflight;
  context: FileActionContext;
  plan: RemoteActionPlan;
  roots: string[];
  identity: string;
  configurations: Array<{ id: string; key: string }>;
};
type Deps = {
  store: Pick<WorkspaceStore, 'get' | 'list'>;
  pool: Pick<SshPool, 'identity' | 'resolveConnection' | 'generation'>;
  browse: Pick<RemoteFilesService, 'context'>;
  executor: RemoteExecutor;
};
const identityHash = (value: string) => createHash('sha256').update(value).digest('hex');

export function createFilePreflights(deps: Deps) {
  const prepared = new Map<string, PreparedAction>();
  async function managed(identity: string, signal: AbortSignal) {
    const workspaces = (await deps.store.list()).sort((a, b) => a.id.localeCompare(b.id));
    const related: Workspace[] = [];
    for (const workspace of workspaces) {
      signal.throwIfAborted();
      if (identityHash(await deps.pool.identity(workspace.sshHost)) === identity) related.push(workspace);
    }
    return related;
  }
  async function validate(action: PreparedAction, strictGeneration = true) {
    const current = await deps.store.get(action.context.workspace.id);
    if (!current || workspaceKey(current) !== workspaceKey(action.context.workspace))
      throw new RemoteFilesError('target_changed');
    const connection = await deps.pool.resolveConnection(workspaceTarget(current));
    if (
      connection.cacheKey !== action.context.key ||
      (strictGeneration && deps.pool.generation(current.sshHost) !== action.context.generation)
    )
      throw new RemoteFilesError('target_changed');
    // 受影响工作区核对已随同步域移除：affectedWorkspaces 恒为空，这里实际只剩工作区配置校验。
    // 非严格模式因此没有可放行的项，保留参数只为调用方语义不变。
    const related = await managed(action.identity, new AbortController().signal);
    const affected = new Set(action.public.affectedWorkspaces.map((item) => item.id));
    const relevant = (id: string) => strictGeneration || affected.has(id);
    const configurations = related
      .filter((workspace) => relevant(workspace.id))
      .map((workspace) => ({ id: workspace.id, key: workspaceKey(workspace) }));
    const expected = action.configurations.filter((item) => relevant(item.id));
    if (JSON.stringify(configurations) !== JSON.stringify(expected)) throw new RemoteFilesError('stale_preflight');
  }
  return {
    validate,
    closeWorkspace(workspaceId: string) {
      for (const [id, action] of prepared) {
        if (
          action.public.workspaceId === workspaceId ||
          action.public.affectedWorkspaces.some((workspace) => workspace.id === workspaceId)
        )
          prepared.delete(id);
      }
    },
    take(workspaceId: string, id: string): PreparedAction {
      const action = prepared.get(id);
      if (!action || action.public.workspaceId !== workspaceId || action.public.expiresAt < Date.now())
        throw new RemoteFilesError('preflight_expired');
      // canSubmit 恒为 true，同步域删除后不会有「等待同步」的预检；保留判断与错误码等 shared 清理时一并移除。
      if (!action.public.canSubmit) throw new RemoteFilesError('sync_pending');
      return action;
    },
    async create(workspaceId: string, sessionId: string, input: RemoteFileActionInput, signal: AbortSignal) {
      for (const [id, action] of prepared) if (action.public.expiresAt < Date.now()) prepared.delete(id);
      if (prepared.size >= 64) throw new RemoteFilesError('too_many_tasks');
      const { identity: actualIdentity, ...context } = await deps.browse.context(workspaceId, sessionId, signal);
      const identity = identityHash(actualIdentity);
      const normalize = (value: string | undefined) =>
        value === undefined ? undefined : remotePath(value, context.info.root, context.info.home);
      const action = { kind: input.kind, source: normalize(input.source), destination: normalize(input.destination) };
      const workspaces = await managed(identity, signal);
      const roots = workspaces.map((workspace) =>
        remotePath(workspace.remoteDir, context.info.home, context.info.home),
      );
      const plan = RemoteActionPlanSchema.parse(
        await deps.executor.run(
          workspaceTarget(context.workspace),
          { action: 'plan', ...action, roots, includeEntries: true },
          { signal },
        ),
      );
      // 同步域删除后远端操作不再影响本机镜像，因此没有受影响工作区，也不需要同步前置条件。
      const preview: RemoteFilePreflight = {
        ...action,
        id: randomUUID(),
        workspaceId,
        sshHost: context.workspace.sshHost,
        expiresAt: Date.now() + 120_000,
        sourceType: plan.sourceType,
        entries: plan.entries,
        files: plan.files,
        bytes: plan.bytes,
        crossFilesystem: plan.crossFilesystem,
        affectedWorkspaces: [],
        canSubmit: true,
        warnings: [],
      };
      const result: PreparedAction = {
        public: preview,
        context,
        plan,
        roots,
        identity,
        configurations: workspaces.map((workspace) => ({ id: workspace.id, key: workspaceKey(workspace) })),
      };
      await validate(result);
      signal.throwIfAborted();
      prepared.set(preview.id, result);
      return preview;
    },
  };
}

export type FilePreflights = ReturnType<typeof createFilePreflights>;
