import type { Workspace } from '@ssh-server/shared';
import type { SyncManager } from '../sync/manager';
import type { WorkspaceStore } from '../workspaces/store';
import { workspaceKey } from './binding';
import { RemoteFilesError } from './errors';
import type { PreparedAction } from './preflight';
import { destinationPaths } from './sync-impact';

export type FileEditingGuard = { reserve(action: PreparedAction, signal: AbortSignal): Promise<() => void> };
type Deps = {
  store: Pick<WorkspaceStore, 'get'>;
  sync: Pick<SyncManager, 'transaction' | 'remoteFiles' | 'status'>;
  editors: FileEditingGuard;
};
type Execution = { execute(): Promise<void>; remoteCompleted(): Promise<void> };

export function createFileSyncCoordinator(deps: Deps) {
  async function workspaces(action: PreparedAction) {
    const result: Workspace[] = [];
    for (const affected of action.public.affectedWorkspaces) {
      const workspace = await deps.store.get(affected.id);
      const expected = action.configurations.find((item) => item.id === affected.id);
      if (!workspace || workspaceKey(workspace) !== expected?.key) throw new RemoteFilesError('target_changed');
      result.push(workspace);
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }
  function transactions<T>(items: Workspace[], signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const next = (index: number): Promise<T> => {
      signal.throwIfAborted();
      return index < items.length ? deps.sync.transaction(items[index]!, () => next(index + 1)) : operation();
    };
    return next(0);
  }
  async function rollback(items: Workspace[], id: string) {
    const outcomes = await Promise.allSettled(
      items.map((workspace) => deps.sync.remoteFiles.abortBeforeDispatch(workspace, id)),
    );
    const failed = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
  async function run(id: string, action: PreparedAction, signal: AbortSignal, execution: Execution) {
    const items = await workspaces(action);
    if (!items.length) {
      await execution.execute();
      await execution.remoteCompleted();
      return true;
    }
    return transactions(items, signal, async () => {
      // 排队结束后再次读取配置；预留握手确认各编辑器的最新缓冲，之后才建立基线。
      await workspaces(action);
      const release = await deps.editors.reserve(action, signal);
      let dispatched = false;
      try {
        for (const workspace of items) {
          signal.throwIfAborted();
          await deps.sync.remoteFiles.prepare(workspace, id, signal);
          const affected = action.public.affectedWorkspaces.find((item) => item.id === workspace.id)!;
          await deps.sync.remoteFiles.checkPaths(
            workspace,
            destinationPaths(workspace, affected.remoteRoot, action.plan, action.public),
            signal,
          );
        }
        signal.throwIfAborted();
        dispatched = true;
        await execution.execute();
        await execution.remoteCompleted();
        signal.throwIfAborted();
        let completed = true;
        for (const workspace of items) {
          signal.throwIfAborted();
          const status = await deps.sync.remoteFiles.finish(workspace, id, signal);
          completed = completed && status.phase === 'ready' && !status.reason && !status.conflicts.length;
        }
        return completed;
      } finally {
        release();
        if (!dispatched) {
          await rollback(items, id);
        }
      }
    });
  }
  async function recover(id: string, action: PreparedAction, signal: AbortSignal) {
    const items = await workspaces(action);
    return transactions(items, signal, async () => {
      await workspaces(action);
      const release = await deps.editors.reserve(action, signal);
      try {
        let completed = true;
        for (const workspace of items) {
          signal.throwIfAborted();
          const status = await deps.sync.remoteFiles.finish(workspace, id, signal);
          completed = completed && status.phase === 'ready' && !status.reason && !status.conflicts.length;
        }
        return completed;
      } finally {
        release();
      }
    });
  }
  async function abandon(id: string, action: PreparedAction, signal: AbortSignal) {
    const items = await workspaces(action);
    return transactions(items, signal, async () => {
      await rollback(items, id);
      const statuses = await Promise.all(items.map((workspace) => deps.sync.status(workspace)));
      return statuses.every((status) => status.phase === 'ready' && !status.reason);
    });
  }
  return { run, recover, abandon };
}
export type FileSyncCoordinator = ReturnType<typeof createFileSyncCoordinator>;
