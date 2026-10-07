import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncSettingsSchema } from '@ssh-server/shared';
import { createWorkspaceStore } from '../../src/workspaces/store';
import { createWorkspaceActivity } from '../../src/workspaces/activity';
import { createWorkspaceRemoval } from '../../src/workspaces/removal';
import { createWorkspaceRemovalResources } from '../../src/workspaces/removal-resources';
import { createFileEditors } from '../../src/files/editors';
import { createSyncManager } from '../../src/sync/manager';
import { emptyState, saveSyncState } from '../../src/sync/state';
import { createSetupVerification } from '../../src/workspaces/setup/verification';
import type { SshPool } from '../../src/ssh/pool';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workspace-removal-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const localDir = path.join(root, 'project');
  const configDir = path.join(root, 'config');
  await mkdir(localDir);
  const store = createWorkspaceStore({ configDir, knownHosts: async () => ['my-server'], dirExists: async () => true });
  const workspace = await store.create({ name: '演示', localDir, sshHost: 'my-server', remoteDir: '~/projects/demo' });
  const activity = createWorkspaceActivity();
  const blockers = vi.fn(async () => [] as Array<{ code: string; message: string }>);
  const close = vi.fn(() => undefined);
  const removal = createWorkspaceRemoval({ store, activity, blockers, close });
  const preview = await removal.preview(workspace.id);
  const input = { confirmed: true as const, configuration: preview.configuration };
  return { root, localDir, configDir, store, workspace, activity, blockers, close, removal, input };
}

describe('工作区配置移除的核心边界', () => {
  it('活动租约幂等释放，删除独占拒绝新请求，异常解除closing且其他工作区继续', async () => {
    const activity = createWorkspaceActivity();
    const release = activity.acquire('demo');
    await expect(activity.exclusive('demo', async () => undefined)).rejects.toMatchObject({
      code: 'workspace_busy',
      status: 409,
    });
    release();
    release();
    const finish = gate();
    const operation = activity.exclusive('demo', () => finish.promise);
    expect(() => activity.acquire('demo')).toThrow('正在移除');
    await expect(activity.exclusive('demo', async () => undefined)).rejects.toMatchObject({
      code: 'workspace_deleting',
    });
    const other = activity.acquire('other');
    expect(activity.active('other')).toBe(1);
    other();
    finish.resolve();
    await operation;
    await expect(
      activity.exclusive('demo', async () => {
        throw new Error('故障');
      }),
    ).rejects.toThrow('故障');
    expect(() => activity.assertOpen('demo')).not.toThrow();
    expect(activity.active('demo')).toBe(0);
  });

  it('真实配置移除保留项目、Git、历史和另一配置，重复移除为404', async () => {
    const f = await fixture();
    await mkdir(path.join(f.localDir, '.git'));
    const files = [
      path.join(f.localDir, 'script.py'),
      path.join(f.localDir, '.git', 'marker'),
      path.join(f.root, 'native-history.json'),
    ];
    for (const file of files) await writeFile(file, '保留内容');
    const { id: _id, ...input } = f.workspace;
    const other = await f.store.create({ ...input, name: '其他工作区' });
    expect(await f.removal.remove(f.workspace.id, f.input)).toEqual({ removed: true });
    expect(await f.store.list()).toEqual([other]);
    for (const file of files) expect(await readFile(file, 'utf8')).toBe('保留内容');
    expect(f.close).toHaveBeenCalledExactlyOnceWith(f.workspace.id);
    await expect(f.removal.remove(f.workspace.id, f.input)).rejects.toMatchObject({
      code: 'workspace_missing',
      status: 404,
    });
    await expect(f.removal.preview(f.workspace.id)).rejects.toMatchObject({ code: 'workspace_missing' });
    expect(f.activity.active(f.workspace.id)).toBe(0);
  });

  it('陈旧确认及写盘前新增阻断都保留配置，重新预览可以重试', async () => {
    const f = await fixture();
    await f.store.update(f.workspace.id, { name: '修改后的配置' });
    await expect(f.removal.remove(f.workspace.id, f.input)).rejects.toMatchObject({ code: 'workspace_changed' });
    const next = await f.removal.preview(f.workspace.id);
    const input = { ...f.input, configuration: next.configuration };
    f.blockers.mockResolvedValueOnce([]).mockResolvedValueOnce([{ code: 'file_tasks_pending', message: '待核对任务' }]);
    await expect(f.removal.remove(f.workspace.id, input)).rejects.toMatchObject({ code: 'workspace_busy' });
    expect(await f.store.get(f.workspace.id)).toBeDefined();
    expect(f.close).not.toHaveBeenCalled();
    expect(await f.removal.remove(f.workspace.id, input)).toEqual({ removed: true });
  });

  it('保存失败不清理通道或锁死目标；清理失败明确表示配置已移除', async () => {
    const f = await fixture();
    vi.spyOn(f.store, 'remove').mockRejectedValueOnce(new Error('写盘失败'));
    await expect(f.removal.remove(f.workspace.id, f.input)).rejects.toMatchObject({
      code: 'workspace_remove_failed',
      status: 503,
    });
    expect(await f.store.get(f.workspace.id)).toBeDefined();
    expect(f.close).not.toHaveBeenCalled();
    expect(() => f.activity.assertOpen(f.workspace.id)).not.toThrow();
    f.close.mockImplementationOnce(() => {
      throw new Error('通道异常');
    });
    expect(await f.removal.remove(f.workspace.id, f.input)).toMatchObject({
      removed: true,
      cleanupWarning: expect.any(String),
    });
    expect(await f.store.get(f.workspace.id)).toBeUndefined();
  });

  it('预览显示其他活动，活动结束后预览本身不构成阻断', async () => {
    const f = await fixture();
    const release = f.activity.acquire(f.workspace.id);
    expect((await f.removal.preview(f.workspace.id)).blockers).toContainEqual(
      expect.objectContaining({ code: 'workspace_busy' }),
    );
    await expect(f.removal.remove(f.workspace.id, f.input)).rejects.toMatchObject({ code: 'workspace_busy' });
    release();
    expect((await f.removal.preview(f.workspace.id)).blockers).toEqual([]);
  });

  it('干净和离线编辑器均保持持久登记，显式处理后才能移除', async () => {
    const f = await fixture();
    const editors = createFileEditors(f.configDir, f.activity.acquire);
    const peer = { send: vi.fn() };
    const id = '00000000-0000-4000-8000-000000000001';
    await editors.attach(id, f.workspace.id, peer);
    await editors.receive(id, peer, { type: 'state', state: { path: null, dirty: false, busy: false } });
    expect(await editors.hasWorkspace(f.workspace.id)).toBe(true);
    editors.detach(id, peer);
    const restarted = createFileEditors(f.configDir, f.activity.acquire);
    expect(await restarted.hasWorkspace(f.workspace.id)).toBe(true);
    f.blockers.mockImplementation(async () =>
      (await restarted.hasWorkspace(f.workspace.id)) ? [{ code: 'editors_registered', message: '编辑器仍登记' }] : [],
    );
    await expect(f.removal.remove(f.workspace.id, f.input)).rejects.toMatchObject({ code: 'workspace_busy' });
    await restarted.forget(f.workspace.id, id);
    expect(await f.removal.remove(f.workspace.id, f.input)).toEqual({ removed: true });
    await f.activity.exclusive('other', async () => {
      await expect(editors.attach('another', 'other', peer)).rejects.toMatchObject({ code: 'workspace_deleting' });
    });
    expect(f.activity.active('other')).toBe(0);
  });

  it('同步队列与磁盘中的文件任务阻断可读取，forget仅清内存', async () => {
    const f = await fixture();
    const state = { ...emptyState(), remoteTask: '00000000-0000-4000-8000-000000000002' };
    await saveSyncState(f.configDir, f.workspace.id, state);
    const sync = createSyncManager({ configDir: f.configDir, driver: { open: vi.fn() } });
    expect(await sync.hasRemoteTask(f.workspace.id)).toBe(true);
    sync.forget(f.workspace.id);
    expect(await sync.hasRemoteTask(f.workspace.id)).toBe(true);
    const finish = gate();
    const transaction = sync.transaction(f.workspace, () => finish.promise);
    expect(sync.busy(f.workspace.id)).toBe(true);
    finish.resolve();
    await transaction;
    expect(sync.busy(f.workspace.id)).toBe(false);
    sync.dispose();
  });

  it('聚合阻断不重入store，收尾某项失败仍尝试全部所属模块', async () => {
    const close = vi.fn(() => {
      throw new Error('终端收尾失败');
    });
    const browse = vi.fn();
    const preflight = vi.fn();
    const forget = vi.fn();
    const resources = createWorkspaceRemovalResources({
      editors: { hasWorkspace: async () => true },
      sync: { busy: () => true, hasRemoteTask: async () => true, forget },
      tasks: { blockers: async () => [{ code: 'file_tasks_pending', message: '待恢复' }] },
      terminals: { closeWorkspace: close },
      browse: { closeWorkspace: browse },
      preflights: { closeWorkspace: preflight },
    });
    expect((await resources.blockers('demo')).map((item) => item.code)).toEqual([
      'file_tasks_pending',
      'sync_busy',
      'sync_task_pending',
      'editors_registered',
    ]);
    await expect(resources.close('demo')).rejects.toThrow('未全部完成');
    for (const method of [close, browse, preflight, forget]) expect(method).toHaveBeenCalledExactlyOnceWith('demo');
  });

  it.each([false, true])('首次初始化租约从写盘前持续到成功或失败收尾：失败=%s', async (failed) => {
    const f = await fixture();
    const finish = gate();
    const pool = {
      generation: () => 1,
      resolveConnection: async () => ({ cacheKey: 'fixture' }),
    } as unknown as SshPool;
    const status = { phase: 'ready' as const, settings: SyncSettingsSchema.parse({}), deletions: [], conflicts: [] };
    const service = createSetupVerification({
      pool,
      store: f.store,
      acquireWorkspace: f.activity.acquire,
      inspectRemote: async () => ({
        path: path.posix.join(path.posix.sep, 'fixture-home', 'project'),
        empty: true,
        git: false,
      }),
      sync: {
        initialize: async () => {
          await finish.promise;
          if (failed) throw new Error('初始化失败');
          return status;
        },
        status: async () => status,
      },
    });
    const { id: _id, ...input } = f.workspace;
    const ticket = await service.verify(input, new AbortController().signal);
    const creation = service.create(
      { input, verification: ticket.verification, initializationConfirmed: true },
      new AbortController().signal,
    );
    let id = '';
    try {
      await vi.waitFor(async () => {
        id = (await f.store.list()).find((workspace) => workspace.id !== f.workspace.id)?.id ?? '';
        expect(id).not.toBe('');
        expect(f.activity.active(id)).toBe(1);
      });
      await expect(f.activity.exclusive(id, async () => undefined)).rejects.toMatchObject({ code: 'workspace_busy' });
    } finally {
      finish.resolve();
    }
    const result = await creation;
    expect(result.sync.phase).toBe(failed ? 'error' : 'ready');
    expect(f.activity.active(id)).toBe(0);
    service.dispose();
  });
});
