import { createHash, randomUUID } from 'node:crypto';
import { type RemoteFileActionInput, type RemoteFilePreflight, type Workspace } from '@ssh-server/shared';
import type { SshPool } from '../ssh/pool';
import { workspaceTarget } from '../ssh/connection';
import type { WorkspaceStore } from '../workspaces/store';
import { workspaceKey } from './binding';
import { RemoteFilesError } from './errors';
import { RemoteActionPlanSchema, type RemoteActionPlan, type RemoteExecutor } from './executor';
import { remotePath } from './paths';
import { destinationPaths, syncImpact } from './sync-impact';
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
  syncAvailable?: boolean;
  syncPaths?: (workspace: Workspace, incoming: string[], signal: AbortSignal) => Promise<void>;
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
    const related = await managed(action.identity, new AbortController().signal);
    const affected = new Set(action.public.affectedWorkspaces.map((item) => item.id));
    const relevant = (id: string) => strictGeneration || affected.has(id);
    const configurations = related
      .filter((workspace) => relevant(workspace.id))
      .map((workspace) => ({ id: workspace.id, key: workspaceKey(workspace) }));
    const expected = action.configurations.filter((item) => relevant(item.id));
    if (JSON.stringify(configurations) !== JSON.stringify(expected)) throw new RemoteFilesError('stale_preflight');
  }
  async function checkDestinations(
    workspaces: Workspace[],
    affected: RemoteFilePreflight['affectedWorkspaces'],
    input: { plan: RemoteActionPlan; action: RemoteFileActionInput; signal: AbortSignal },
  ) {
    const { plan, action, signal } = input;
    for (const item of affected) {
      const workspace = workspaces.find((workspace) => workspace.id === item.id)!;
      await deps.syncPaths?.(workspace, destinationPaths(workspace, item.remoteRoot, plan, action), signal);
    }
  }
  return {
    validate,
    take(workspaceId: string, id: string): PreparedAction {
      const action = prepared.get(id);
      if (!action || action.public.workspaceId !== workspaceId || action.public.expiresAt < Date.now())
        throw new RemoteFilesError('preflight_expired');
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
      const impact = syncImpact(workspaces, plan, action);
      const affectedWorkspaces = impact.affected;
      await checkDestinations(workspaces, affectedWorkspaces, { plan, action, signal });
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
        affectedWorkspaces,
        canSubmit: affectedWorkspaces.length === 0 || (!!deps.syncAvailable && impact.complete),
        warnings: affectedWorkspaces.length
          ? [
              deps.syncAvailable && impact.complete
                ? '该操作会协调相关同步文件，存在未保存编辑、冲突或待确认删除时不执行。'
                : '该操作涉及同步范围，当前仍待完整元数据与同步路径协调。',
            ]
          : [],
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
