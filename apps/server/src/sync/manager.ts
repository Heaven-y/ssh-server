// 每工作区独立队列：同步与远程执行组成同一事务；待确认与失败阻断执行。
import { SyncSettingsSchema, type SyncSettings, type SyncStatus, type Workspace } from '@ssh-server/shared';
import { SshConnectionError } from '../ssh/connection';
import { SyncError } from './errors';
import { eligibleFile } from './filters';
import { preserveInitialConflicts } from './initialize';
import { hash, localInventory, type FileEntry } from './inventory';
import type { RcloneContext, SyncDriver } from './rclone';
import { localFileMissing, stageSnapshot } from './snapshot';
import { loadSyncState, newConflicts, publicStatus, saveSyncState, settingsDigest, type SyncState } from './state';

type Deps = { configDir: string; driver: SyncDriver };
type SyncOptions = { initialize?: boolean; confirmed?: boolean; approved?: Map<string, string> };
export function createSyncManager(deps: Deps) {
  const states = new Map<string, Promise<SyncState>>();
  const queues = new Map<string, Promise<unknown>>();
  const active = new Set<RcloneContext>();
  let disposed = false;
  const get = (ws: Workspace) => {
    let state = states.get(ws.id);
    if (!state) {
      state = loadSyncState(deps.configDir, ws.id);
      states.set(ws.id, state);
    }
    return state;
  };
  const settingsOf = (ws: Workspace) => SyncSettingsSchema.parse(ws.sync ?? {});
  const configurationOf = (ws: Workspace) => hash(JSON.stringify([ws.sshHost, ws.remoteDir, ws.localDir]));
  const save = (ws: Workspace, state: SyncState) => saveSyncState(deps.configDir, ws.id, state);
  function transaction<T>(ws: Workspace, fn: () => Promise<T>): Promise<T> {
    const execute = () => {
      if (disposed) throw new SyncError('disposed', '同步服务已停止');
      return fn();
    };
    const run = (queues.get(ws.id) ?? Promise.resolve()).then(execute, execute);
    queues.set(ws.id, run);
    void run
      .finally(() => {
        if (queues.get(ws.id) === run) queues.delete(ws.id);
      })
      .catch(() => undefined);
    return run;
  }
  function confirmation(state: SyncState, reason: SyncStatus['reason'], message: string): void {
    Object.assign(state, { phase: 'confirmation_required', reason, message });
  }
  async function fail(ws: Workspace, state: SyncState, error: unknown): Promise<void> {
    const message =
      error instanceof SyncError || error instanceof SshConnectionError
        ? error.message
        : '同步失败，已暂停远程执行；请检查连接与本地状态后确认恢复';
    Object.assign(state, { phase: 'error', reason: 'recovery', message });
    await save(ws, state).catch(() => {
      state.message = '本地同步状态无法保存，已暂停执行；请检查配置目录权限';
    });
  }
  function blocked(state: SyncState, options: SyncOptions): boolean {
    if (state.phase === 'conflicts' || state.reason === 'deletions') return true;
    if (options.initialize) return false;
    return (
      state.phase === 'error' ||
      state.phase === 'confirmation_required' ||
      !!state.reason ||
      !!state.conflicts.length ||
      !!state.deletions.length
    );
  }
  async function detectDeletions(
    input: { ws: Workspace; state: SyncState; local: FileEntry[]; remote: FileEntry[]; approved?: Map<string, string> },
    context: RcloneContext,
  ): Promise<boolean> {
    const local = new Set(input.local.map((file) => file.path));
    const remote = new Set(input.remote.map((file) => file.path));
    const missing = input.state.baseline
      .filter((file) => !local.has(file.path) && remote.has(file.path) && !input.approved?.has(file.path))
      .map((file) => file.path);
    if (!missing.length) return false;
    input.state.deletions = missing;
    input.state.deletionHashes = {};
    for (const file of missing) input.state.deletionHashes[file] = hash(await context.readRemote(file));
    confirmation(input.state, 'deletions', '本地删除待确认，该工作区同步与执行已暂停');
    return true;
  }
  type Snapshot = {
    ws: Workspace;
    state: SyncState;
    settings: SyncSettings;
    options: SyncOptions;
    local: Awaited<ReturnType<typeof localInventory>>;
  };
  function needsInitialization(input: Snapshot, digest: string) {
    const { ws, state, options } = input;
    const filterChanged = !!state.filters && state.filters !== digest;
    const targetChanged = !!state.configuration && state.configuration !== configurationOf(ws);
    const needsInit = !state.signature || filterChanged || targetChanged || options.initialize === true;
    return { filterChanged, needsInit };
  }
  async function initializationPlan(input: Snapshot) {
    const { ws, state, settings, options, local } = input;
    const digest = settingsDigest(settings);
    const { filterChanged, needsInit } = needsInitialization(input, digest);
    const canAuto = !state.signature && !local.included.length && state.reason !== 'recovery';
    const proceed = !needsInit || !!options.confirmed || canAuto;
    if (!proceed) {
      const reason = filterChanged ? 'filter_changed' : 'initialization';
      confirmation(state, reason, '请确认初始化或恢复；同名差异会保留双方版本，处理后才允许执行');
      await save(ws, state);
    }
    return { digest, needsInit, proceed };
  }
  function excludedCollision(input: Snapshot, remoteAll: FileEntry[]): boolean {
    const localSmall = new Set(input.local.included.map((file) => file.path));
    const remoteSmall = new Set(
      remoteAll.filter((file) => eligibleFile(file.path, file.size, input.settings)).map((file) => file.path),
    );
    const hasExcluded = (files: FileEntry[], opposite: Set<string>) =>
      files.some((file) => opposite.has(file.path) && !eligibleFile(file.path, file.size, input.settings));
    return hasExcluded(input.local.all, remoteSmall) || hasExcluded(remoteAll, localSmall);
  }
  async function checkSnapshot(input: Snapshot, context: RcloneContext): Promise<FileEntry[] | undefined> {
    const { ws, state, settings, options, local } = input;
    if (state.signature && context.signature !== state.signature && !options.confirmed) {
      confirmation(state, 'recovery', 'SSH 目标或目录发生变化，请确认新目录初始化');
      await save(ws, state);
      return undefined;
    }
    const remoteAll = await context.listRemote(true);
    const prior = new Set(state.baseline.map((file) => file.path));
    const oversized = [...local.all, ...remoteAll].some(
      (file) => prior.has(file.path) && !eligibleFile(file.path, file.size, settings),
    );
    const collision = excludedCollision(input, remoteAll);
    if (collision || (oversized && !options.initialize)) {
      confirmation(
        state,
        'filter_changed',
        '同名文件一端已超出同步范围，请调整阈值或改名后重建基线；不会覆盖被排除文件',
      );
      await save(ws, state);
      return undefined;
    }
    return remoteAll.filter((file) => eligibleFile(file.path, file.size, settings));
  }
  type TransferInput = Snapshot & { remote: FileEntry[]; digest: string; needsInit: boolean };
  async function transferPlan(input: TransferInput) {
    const resync = input.needsInit || input.state.baseline.length === 0;
    const deletions = [...(input.options.approved ?? [])];
    if (resync || (input.local.included.length && input.remote.length)) return { resync, deletions };
    if (deletions.length) return { resync: true, deletions };
    confirmation(input.state, 'recovery', '一端同步范围已为空，请核对两端目录后确认恢复；未自动传播清空');
    await save(input.ws, input.state);
    return undefined;
  }
  async function prepareMirror(input: TransferInput, context: RcloneContext) {
    const snapshot = await stageSnapshot({ configDir: deps.configDir, ws: input.ws, settings: input.settings });
    const fresh = { ...input, local: { included: snapshot.inventory, all: snapshot.all } };
    for (const file of snapshot.all) fresh.options.approved?.delete(file.path);
    const remote = await checkSnapshot(fresh, context);
    if (!remote) return undefined;
    fresh.remote = remote;
    if (
      !fresh.needsInit &&
      (await detectDeletions({ ...fresh, local: snapshot.inventory, approved: fresh.options.approved }, context))
    ) {
      await save(fresh.ws, fresh.state);
      return undefined;
    }
    const plan = await transferPlan(fresh);
    return plan ? { snapshot, input: fresh, plan } : undefined;
  }
  async function applyApprovedDeletions(input: TransferInput, context: RcloneContext) {
    for (const [file, digest] of input.options.approved ?? []) {
      const current = hash(await context.readRemote(file));
      if (!(await localFileMissing(input.ws.localDir, file))) {
        input.options.approved?.delete(file);
        continue;
      }
      if (current !== digest)
        throw new SyncError('remote_changed', '远端文件在确认后变化，已停止删除，请重新核对并确认恢复');
      await context.deleteRemote(file);
    }
  }
  async function transfer(input: TransferInput, context: RcloneContext): Promise<void> {
    const { ws, state, settings, options, digest } = input;
    let prepared = await prepareMirror(input, context);
    if (!prepared) return;
    const previous = state.baseline;
    Object.assign(state, { phase: 'syncing', reason: undefined, message: undefined });
    await save(ws, state);
    await applyApprovedDeletions(prepared.input, context);
    if (prepared.plan.deletions.length) prepared = await prepareMirror(prepared.input, context);
    if (!prepared) return;
    const conflicts = prepared.plan.resync
      ? await preserveInitialConflicts(
          { ws, settings, local: prepared.snapshot.inventory, remote: prepared.input.remote },
          context,
        )
      : [];
    if (prepared.plan.resync) prepared = await prepareMirror(prepared.input, context);
    if (!prepared) return;
    await context.bisync({
      resync: prepared.plan.resync,
      allowAllDeletes: !!options.approved?.size,
      allowAllChanges: true,
      localDir: prepared.snapshot.localDir,
    });
    state.baseline = (await localInventory(prepared.snapshot.localDir, settings)).included;
    state.conflicts = [...conflicts, ...(await prepared.snapshot.apply()), ...newConflicts(state.baseline, previous)];
    Object.assign(state, {
      signature: context.signature,
      configuration: configurationOf(ws),
      filters: digest,
      phase: state.conflicts.length ? 'conflicts' : 'ready',
      reason: undefined,
      deletions: [],
      deletionHashes: {},
      message: state.conflicts.length ? '双端版本已保留，请将选定内容恢复到原路径后确认' : undefined,
      lastSuccessAt: Date.now(),
    });
    await save(ws, state);
  }
  async function perform(ws: Workspace, options: SyncOptions = {}): Promise<SyncStatus> {
    const state = await get(ws);
    const settings = settingsOf(ws);
    if (blocked(state, options)) return publicStatus(state, settings);
    let context: RcloneContext | undefined;
    try {
      const local = await localInventory(ws.localDir, settings);
      const input = { ws, state, settings, options, local };
      const plan = await initializationPlan(input);
      if (!plan.proceed) return publicStatus(state, settings);
      context = await deps.driver.open(ws, settings);
      active.add(context);
      const remote = await checkSnapshot(input, context);
      if (remote) await transfer({ ...input, ...plan, remote }, context);
    } catch (error) {
      await fail(ws, state, error);
    } finally {
      if (context) {
        active.delete(context);
        context.close();
      }
    }
    return publicStatus(state, settings);
  }
  async function decide(ws: Workspace, decision: 'confirm' | 'reject'): Promise<SyncStatus> {
    const state = await get(ws);
    const settings = settingsOf(ws);
    if (state.reason !== 'deletions' || !state.deletions.length) return publicStatus(state, settings);
    let context: RcloneContext | undefined;
    try {
      context = await deps.driver.open(ws, settings);
      active.add(context);
      if (context.signature !== state.signature)
        throw new SyncError('target_changed', '连接目标已变化，无法处理旧目录的删除，请确认恢复');
      const local = new Set((await localInventory(ws.localDir, settings)).all.map((file) => file.path));
      const remote = new Set((await context.listRemote()).map((file) => file.path));
      const missing = state.deletions.filter((file) => !local.has(file));
      const approved = new Map<string, string>();
      for (const file of missing) {
        if (!remote.has(file)) continue;
        if (decision === 'reject') {
          await context.restore(file);
          continue;
        }
        const current = hash(await context.readRemote(file));
        if (current !== state.deletionHashes[file]) {
          state.deletionHashes[file] = current;
          state.message = '待确认后远端文件已修改，请核对后再次确认；未删除任何文件';
          await save(ws, state);
          return publicStatus(state, settings);
        }
        approved.set(file, current);
      }
      Object.assign(state, {
        phase: 'ready',
        reason: undefined,
        message: undefined,
        deletions: [],
        deletionHashes: {},
      });
      await save(ws, state);
      context.close();
      active.delete(context);
      context = undefined;
      return await perform(ws, { approved });
    } catch (error) {
      await fail(ws, state, error);
    } finally {
      if (context) {
        active.delete(context);
        context.close();
      }
    }
    return publicStatus(state, settings);
  }
  return {
    transaction,
    async status(ws: Workspace): Promise<SyncStatus> {
      const state = await get(ws);
      const settings = settingsOf(ws);
      if (state.filters && state.filters !== settingsDigest(settings))
        return {
          ...publicStatus(state, settings),
          phase: 'confirmation_required',
          reason: 'filter_changed',
          message: '过滤设置已修改，请确认重建同步基线',
        };
      return publicStatus(state, settings);
    },
    sync: (ws: Workspace) => transaction(ws, () => perform(ws)),
    initialize: (ws: Workspace, confirmed: boolean) =>
      transaction(ws, () => perform(ws, { initialize: true, confirmed })),
    resolveDeletions: (ws: Workspace, decision: 'confirm' | 'reject') => transaction(ws, () => decide(ws, decision)),
    acknowledgeConflicts: (ws: Workspace) =>
      transaction(ws, async () => {
        const state = await get(ws);
        const settings = settingsOf(ws);
        if (state.phase !== 'conflicts' || !state.conflicts.length) return publicStatus(state, settings);
        const present = new Set((await localInventory(ws.localDir, settings)).included.map((file) => file.path));
        if (state.conflicts.some((conflict) => !present.has(conflict.path)))
          return publicStatus({ ...state, message: '请先将选定内容恢复到原始文件路径' }, settings);
        Object.assign(state, { phase: 'ready', conflicts: [], message: undefined });
        await save(ws, state);
        return perform(ws);
      }),
    execute: <T extends object>(ws: Workspace, command: () => Promise<T>): Promise<T & { sync: SyncStatus }> =>
      transaction(ws, async () => {
        const before = await perform(ws);
        if (before.phase !== 'ready' || before.reason || before.deletions.length || before.conflicts.length)
          throw new SyncError('sync_blocked', before.message ?? '同步尚未就绪，远程命令未执行');
        const result = await command();
        const after = await perform(ws);
        return { ...result, sync: after };
      }),
    dispose() {
      disposed = true;
      for (const context of active) context.close();
      active.clear();
    },
  };
}
export type SyncManager = ReturnType<typeof createSyncManager>;
