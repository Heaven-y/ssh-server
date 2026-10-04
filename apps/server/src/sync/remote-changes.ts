// 调用者持有工作区事务；恢复只处理同步结果，绝不重放服务器写操作。
import type { SyncSettings, SyncStatus, Workspace } from '@ssh-server/shared';
import { SyncError } from './errors';
import { hash, localHash, localInventory, type FileEntry } from './inventory';
import type { RcloneContext, SyncDriver } from './rclone';
import { restoreTaskSnapshot, stageRemoteBaseline, stageSnapshot } from './snapshot';
import { publicStatus, type SyncState } from './state';
import { bindSyncCancellation } from './cancellation';
import { assertCompatiblePaths } from './filters';

type Deps = {
  configDir: string;
  driver: SyncDriver;
  active: Set<RcloneContext>;
  get(ws: Workspace): Promise<SyncState>;
  save(ws: Workspace, state: SyncState): Promise<void>;
  settingsOf(ws: Workspace): SyncSettings;
};
const listingKey = (files: FileEntry[]) =>
  JSON.stringify(
    files.map((file) => [file.path, file.size, file.modTime]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );

async function verifyMirror(ws: Workspace, settings: SyncSettings, directory: string, context: RcloneContext) {
  const before = await context.listRemote();
  const local = (await localInventory(directory, settings)).included;
  const byPath = new Map(local.map((file) => [file.path, file]));
  if (byPath.size !== before.length) throw new SyncError('remote_changed', '远端文件在拉取期间变化，已暂停基线重建');
  for (const file of before) {
    const current = byPath.get(file.path);
    if (
      !current ||
      current.size !== file.size ||
      (await localHash(directory, current, settings)) !== hash(await context.readRemote(file.path))
    )
      throw new SyncError('remote_changed', '远端文件在核对期间变化，已保留任务快照');
  }
  if (listingKey(before) !== listingKey(await context.listRemote()))
    throw new SyncError('remote_changed', `工作区“${ws.name}”的远端清单已改变，请重试同步恢复`);
}

export function createRemoteFileChanges(deps: Deps) {
  async function checkPaths(ws: Workspace, incoming: string[], signal: AbortSignal) {
    if (!incoming.length) return;
    signal.throwIfAborted();
    const settings = deps.settingsOf(ws);
    const context = await deps.driver.open(ws, settings);
    deps.active.add(context);
    const unbind = bindSyncCancellation(context, signal);
    try {
      const remote = await context.listRemote(true);
      const local = await localInventory(ws.localDir, settings);
      // 本地排除文件与目录仍占用名称；大小写改名也保守拒绝，避免残留目录别名。
      assertCompatiblePaths(
        [...incoming, ...remote.map((file) => file.path), ...local.all.map((file) => file.path)],
        local.directories,
      );
      signal.throwIfAborted();
    } finally {
      unbind();
      deps.active.delete(context);
      context.close();
    }
  }
  async function prepare(ws: Workspace, id: string, synchronize: () => Promise<SyncStatus>, signal?: AbortSignal) {
    const before = await synchronize();
    signal?.throwIfAborted();
    if (before.phase !== 'ready' || before.reason || before.deletions.length || before.conflicts.length)
      throw new SyncError('sync_blocked', before.message ?? '同步尚未就绪，服务器文件操作未执行');
    const state = await deps.get(ws);
    state.remoteTask = id;
    await deps.save(ws, state);
    await stageSnapshot({ configDir: deps.configDir, ws, settings: deps.settingsOf(ws), snapshotId: id });
    signal?.throwIfAborted();
  }
  async function finish(ws: Workspace, id: string, signal?: AbortSignal): Promise<SyncStatus> {
    const cancellation = signal ?? new AbortController().signal;
    const state = await deps.get(ws);
    const settings = deps.settingsOf(ws);
    if (!state.remoteTask) return publicStatus(state, settings);
    if (state.remoteTask !== id) throw new SyncError('sync_blocked', '该工作区仍由另一项文件任务等待恢复');
    let context: RcloneContext | undefined;
    let unbindCancellation = () => {};
    try {
      cancellation.throwIfAborted();
      const snapshot = await restoreTaskSnapshot({ configDir: deps.configDir, ws, settings }, id);
      context = await deps.driver.open(ws, settings);
      deps.active.add(context);
      unbindCancellation = bindSyncCancellation(context, signal);
      if (context.signature !== state.signature)
        throw new SyncError('target_changed', 'SSH 目标或同步目录已改变，不能恢复旧任务');
      if (!context.pullMirror) throw new SyncError('sync_unavailable', '当前传输实现不支持文件任务恢复');
      await context.pullMirror(snapshot.localDir);
      await verifyMirror(ws, settings, snapshot.localDir, context);
      const baselineDirectory = await stageRemoteBaseline(
        { configDir: deps.configDir, ws, settings },
        snapshot.localDir,
      );
      await verifyMirror(ws, settings, baselineDirectory, context);
      // 仅使用刚从远端拉取的镜像；不以工作区中尚未迁移的旧路径作为上传源。
      await context.bisync({
        resync: true,
        remoteAuthoritative: true,
        allowAllDeletes: true,
        allowAllChanges: true,
        localDir: baselineDirectory,
      });
      await verifyMirror(ws, settings, baselineDirectory, context);
      cancellation.throwIfAborted();
      const conflicts = await snapshot.apply(baselineDirectory);
      cancellation.throwIfAborted();
      state.baseline = (await localInventory(baselineDirectory, settings)).included;
      Object.assign(state, {
        remoteTask: undefined,
        phase: conflicts.length ? 'conflicts' : 'ready',
        reason: undefined,
        conflicts,
        deletions: [],
        deletionHashes: {},
        lastSuccessAt: Date.now(),
        message: conflicts.length ? '服务器变更已协调，外部本地编辑已保留为冲突，请核对后继续同步。' : undefined,
      });
      await deps.save(ws, state);
    } catch (error) {
      Object.assign(state, {
        remoteTask: id,
        phase: 'error',
        reason: 'recovery',
        message: '服务器文件任务的同步协调未完成，旧路径不会自动上传；请从文件任务恢复。',
      });
      await deps.save(ws, state).catch(() => undefined);
      throw error;
    } finally {
      unbindCancellation();
      if (context) {
        deps.active.delete(context);
        context.close();
      }
    }
    return publicStatus(state, settings);
  }
  async function abortBeforeDispatch(ws: Workspace, id: string) {
    const state = await deps.get(ws);
    if (state.remoteTask !== id) return;
    state.remoteTask = undefined;
    await deps.save(ws, state);
  }
  return { prepare, finish, abortBeforeDispatch, checkPaths };
}
