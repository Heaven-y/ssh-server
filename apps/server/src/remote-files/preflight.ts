import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  SyncSettingsSchema,
  type RemoteFileActionInput,
  type RemoteFilePreflight,
  type Workspace,
} from '@ssh-server/shared';
import type { SshPool } from '../ssh/pool';
import { workspaceTarget } from '../ssh/connection';
import { eligibleFile, excludedPath } from '../sync/filters';
import { SyncError } from '../sync/errors';
import type { WorkspaceStore } from '../workspaces/store';
import { workspaceKey } from './binding';
import { RemoteFilesError } from './errors';
import { RemoteActionPlanSchema, type RemoteActionPlan, type RemoteExecutor } from './executor';
import { inside, remotePath } from './paths';
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

function affects(root: string, candidate: string | null | undefined, plan: RemoteActionPlan, ws: Workspace) {
  if (!candidate) return false;
  if (inside(candidate, root)) return true;
  if (!inside(root, candidate)) return false;
  if (plan.sourceType !== 'file') return true;
  const relative = path.posix.relative(root, candidate);
  return synchronizable(relative, Number(plan.sourceFacts?.[3]), ws);
}

function synchronizable(relative: string, size: number, ws: Workspace) {
  const settings = SyncSettingsSchema.parse(ws.sync ?? {});
  if (size > settings.maxFileBytes || excludedPath(relative, settings)) return false;
  try {
    return eligibleFile(relative, size, settings);
  } catch (error) {
    // 服务器合法但镜像无法表示的文件不进入同步范围，仍可仅在服务器管理。
    if (error instanceof SyncError && error.code === 'unsafe_path') return false;
    throw error;
  }
}

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
    const configurations = related.map((workspace) => ({ id: workspace.id, key: workspaceKey(workspace) }));
    if (JSON.stringify(configurations) !== JSON.stringify(action.configurations))
      throw new RemoteFilesError('stale_preflight');
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
        await deps.executor.run(workspaceTarget(context.workspace), { action: 'plan', ...action, roots }, { signal }),
      );
      const affectedWorkspaces = workspaces.flatMap((workspace, index) => {
        const root = plan.roots[index]!;
        return affects(root, action.source, plan, workspace) || affects(root, action.destination, plan, workspace)
          ? [{ id: workspace.id, name: workspace.name, remoteRoot: root }]
          : [];
      });
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
        canSubmit: affectedWorkspaces.length === 0,
        warnings: affectedWorkspaces.length ? ['该操作涉及同步范围，当前仍待接入同步路径协调。'] : [],
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
