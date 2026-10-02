import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncSettingsSchema, type Workspace } from '@ssh-server/shared';
import { createSyncManager } from './manager';
import { localInventory, workspaceStateDir, type FileEntry } from './inventory';
import type { RcloneContext, SyncDriver } from './rclone';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function pruneRemote(remote: Map<string, string>, local: FileEntry[]) {
  for (const file of remote.keys()) if (!local.some((item) => item.path === file)) remote.delete(file);
}
async function setup(local: Record<string, string> = {}, initial: Record<string, string> = {}) {
  const dir = await mkdtemp(path.join(process.env.PI_SCRATCH_DIR ?? os.tmpdir(), 'sync-manager-test-'));
  temps.push(dir);
  const localDir = path.join(dir, 'project');
  const configDir = path.join(dir, 'config');
  await mkdir(localDir);
  for (const [file, content] of Object.entries(local)) await writeFile(path.join(localDir, file), content);
  const remote = new Map(Object.entries(initial));
  const ws: Workspace = { id: 'w1', name: 'demo', localDir, sshHost: 'my-server', remoteDir: '~/projects/demo' };
  const context: RcloneContext = {
    signature: 'fixture-target',
    close: vi.fn(),
    listRemote: async () =>
      [...remote].map(([file, value]) => ({
        path: file,
        size: Buffer.byteLength(value),
        modTime: '2026-01-01T00:00:00Z',
      })),
    readRemote: async (file) => {
      if (!remote.has(file)) throw new Error('missing');
      return Buffer.from(remote.get(file)!);
    },
    restore: vi.fn(async (file) => {
      await writeFile(path.join(localDir, file), remote.get(file)!, { flag: 'wx' });
    }),
    moveRemote: vi.fn(async (from, to) => {
      remote.set(to, remote.get(from)!);
      remote.delete(from);
    }),
    deleteRemote: vi.fn(async (file) => {
      remote.delete(file);
    }),
    bisync: vi.fn(async (options: Parameters<RcloneContext['bisync']>[0]) => {
      const syncDir = options.localDir ?? ws.localDir;
      const localFiles = (await localInventory(syncDir, SyncSettingsSchema.parse(ws.sync ?? {}))).included;
      if (!options.resync && (!localFiles.length || !remote.size)) throw new Error('rclone empty listing safety check');
      if (options.allowAllDeletes) pruneRemote(remote, localFiles);
      for (const file of localFiles) remote.set(file.path, await readFile(path.join(syncDir, file.path), 'utf8'));
      for (const [file, value] of remote) await writeFile(path.join(syncDir, file), value);
    }),
  };
  const driver: SyncDriver = { open: vi.fn(async () => context) };
  const manager = createSyncManager({ configDir, driver });
  return { dir, localDir, configDir, remote, ws, context, driver, manager };
}

describe('工作区同步状态与执行事务', () => {
  it('空本地首拉建立基线，配置状态留在项目外', async () => {
    const { manager, ws, localDir, configDir } = await setup({}, { 'result.txt': 'remote result' });
    expect((await manager.sync(ws)).phase).toBe('ready');
    expect(await readFile(path.join(localDir, 'result.txt'), 'utf8')).toBe('remote result');
    expect(await readdir(localDir)).toEqual(['result.txt']);
    expect(await readFile(path.join(workspaceStateDir(configDir, ws.id), 'state.json'), 'utf8')).toContain(
      'result.txt',
    );
  });
  it('已验证的空基线连续同步和新增第一个文件都可继续', async () => {
    const { manager, ws, localDir, remote } = await setup();
    expect((await manager.sync(ws)).phase).toBe('ready');
    expect((await manager.sync(ws)).phase).toBe('ready');
    await writeFile(path.join(localDir, 'first.py'), 'print(1)');
    expect((await manager.sync(ws)).phase).toBe('ready');
    expect(remote.get('first.py')).toBe('print(1)');
  });
  it('未确认的远端清空暂停，不删除或覆盖本地文件', async () => {
    const { manager, ws, localDir, remote, context } = await setup({}, { 'only.py': 'source' });
    await manager.sync(ws);
    const calls = vi.mocked(context.bisync).mock.calls.length;
    remote.clear();
    expect(await manager.sync(ws)).toMatchObject({ phase: 'confirmation_required', reason: 'recovery' });
    expect(context.bisync).toHaveBeenCalledTimes(calls);
    expect(await readFile(path.join(localDir, 'only.py'), 'utf8')).toBe('source');
  });
  it('非空首次同步需要确认，同名不同内容先保留两版本', async () => {
    const { manager, ws, remote, localDir, context } = await setup(
      { 'code.py': 'local version' },
      { 'code.py': 'remote version' },
    );
    expect(await manager.sync(ws)).toMatchObject({ phase: 'confirmation_required', reason: 'initialization' });
    expect(context.bisync).not.toHaveBeenCalled();
    const status = await manager.initialize(ws, true);
    expect(status.phase).toBe('conflicts');
    const values = [...remote.values()];
    expect(values).toContain('local version');
    expect(values).toContain('remote version');
    expect(await readdir(localDir)).toHaveLength(2);
    await expect(manager.execute(ws, async () => ({ exitCode: 0 }))).rejects.toMatchObject({ code: 'sync_blocked' });
  });
  it('删除暂停整次同步，拒绝恢复远端最新内容；确认才传播删除', async () => {
    const { manager, ws, localDir, remote } = await setup({}, { 'keep.txt': 'initial' });
    await manager.sync(ws);
    await rm(path.join(localDir, 'keep.txt'));
    expect(await manager.sync(ws)).toMatchObject({
      phase: 'confirmation_required',
      reason: 'deletions',
      deletions: ['keep.txt'],
    });
    remote.set('keep.txt', 'remote changed');
    expect((await manager.resolveDeletions(ws, 'reject')).phase).toBe('ready');
    expect(await readFile(path.join(localDir, 'keep.txt'), 'utf8')).toBe('remote changed');
    await rm(path.join(localDir, 'keep.txt'));
    await manager.sync(ws);
    expect((await manager.resolveDeletions(ws, 'confirm')).phase).toBe('ready');
    expect(remote.has('keep.txt')).toBe(false);
  });
  it('待确认时本地重新出现，不删除或覆盖新文件', async () => {
    const { manager, ws, localDir, remote, context } = await setup({}, { 'keep.txt': 'remote' });
    await manager.sync(ws);
    await rm(path.join(localDir, 'keep.txt'));
    await manager.sync(ws);
    await writeFile(path.join(localDir, 'keep.txt'), 'new local content');
    await manager.resolveDeletions(ws, 'reject');
    expect(context.restore).not.toHaveBeenCalled();
    expect(remote.get('keep.txt')).toBe('new local content');
  });
  it('待确认后远端同大小修改，必须重新确认，不能删除新内容', async () => {
    const { manager, ws, localDir, remote, context } = await setup({}, { 'keep.txt': 'old' });
    await manager.sync(ws);
    await rm(path.join(localDir, 'keep.txt'));
    await manager.sync(ws);
    const before = vi.mocked(context.bisync).mock.calls.length;
    remote.set('keep.txt', 'new');
    const status = await manager.resolveDeletions(ws, 'confirm');
    expect(status.phase).toBe('confirmation_required');
    expect(context.bisync).toHaveBeenCalledTimes(before);
    expect(remote.get('keep.txt')).toBe('new');
  });
  it.each([false, true])('确认后删除前远端再次修改时停止，保留其他文件=%s', async (keepOther) => {
    const initial = { 'remove.txt': 'old', ...(keepOther ? { 'other.txt': 'keep' } : {}) };
    const { manager, ws, localDir, remote, context } = await setup({}, initial);
    await manager.sync(ws);
    await rm(path.join(localDir, 'remove.txt'));
    await manager.sync(ws);
    const read = context.readRemote;
    vi.spyOn(context, 'readRemote').mockImplementationOnce(async (file) => {
      const content = await read(file);
      remote.set(file, 'changed-after-confirmation');
      return content;
    });
    const status = await manager.resolveDeletions(ws, 'confirm');
    expect(status.phase).toBe('error');
    expect(remote.get('remove.txt')).toBe('changed-after-confirmation');
    expect(context.deleteRemote).not.toHaveBeenCalled();
  });

  it('同名一端超过大小上限，确认初始化也不能覆盖被排除文件', async () => {
    const { manager, ws, remote, context } = await setup({ 'code.py': 'x'.repeat(30) }, { 'code.py': 'small' });
    const limited = { ...ws, sync: SyncSettingsSchema.parse({ maxFileBytes: 10 }) };
    expect((await manager.initialize(limited, true)).phase).toBe('confirmation_required');
    expect(context.bisync).not.toHaveBeenCalled();
    expect(remote.get('code.py')).toBe('small');
  });
  it('已同步文件变大和过滤变更不被当作删除传播', async () => {
    const { manager, ws, localDir, context } = await setup({}, { 'keep.txt': 'small' });
    await manager.sync(ws);
    await writeFile(path.join(localDir, 'keep.txt'), 'x'.repeat(30));
    const changed = { ...ws, sync: SyncSettingsSchema.parse({ maxFileBytes: 10 }) };
    const before = vi.mocked(context.bisync).mock.calls.length;
    expect(await manager.sync(changed)).toMatchObject({ phase: 'confirmation_required', reason: 'filter_changed' });
    expect(context.bisync).toHaveBeenCalledTimes(before);
  });
  it('损坏状态不静默 resync，须显式恢复', async () => {
    const { manager, ws, configDir, driver, context } = await setup();
    await manager.sync(ws);
    await writeFile(path.join(workspaceStateDir(configDir, ws.id), 'state.json'), '{bad');
    const recovered = createSyncManager({ configDir, driver });
    vi.mocked(context.bisync).mockClear();
    expect(await recovered.sync(ws)).toMatchObject({ phase: 'confirmation_required', reason: 'recovery' });
    expect(context.bisync).not.toHaveBeenCalled();
  });
  it('前同步未就绪不执行；后同步失败仍保留命令输出和退出码', async () => {
    const { manager, ws, context } = await setup({ 'a.py': 'source' });
    const command = vi.fn(async () => ({ exitCode: 7, stdout: 'actual output' }));
    await expect(manager.execute(ws, command)).rejects.toMatchObject({ code: 'sync_blocked' });
    expect(command).not.toHaveBeenCalled();
    await manager.initialize(ws, true);
    vi.mocked(context.bisync).mockResolvedValueOnce().mockRejectedValueOnce(new Error('private-transport-secret'));
    const result = await manager.execute(ws, command);
    expect(result).toMatchObject({ exitCode: 7, stdout: 'actual output', sync: { phase: 'error' } });
    expect(JSON.stringify(result)).not.toContain('private-transport-secret');
  });
  it('同工作区串行，不同工作区不共用锁；失败后队列仍可继续', async () => {
    const { manager, ws } = await setup();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const one = manager.transaction(ws, async () => {
      order.push('one');
      await gate;
      order.push('one-end');
    });
    const two = manager.transaction(ws, async () => {
      order.push('two');
      throw new Error('fixture');
    });
    const errorCheck = expect(two).rejects.toThrow('fixture');
    await manager.transaction({ ...ws, id: 'w2' }, async () => {
      order.push('other');
    });
    expect(order).toEqual(['one', 'other']);
    release();
    await one;
    await errorCheck;
    await manager.transaction(ws, async () => {
      order.push('three');
    });
    expect(order).toEqual(['one', 'other', 'one-end', 'two', 'three']);
  });

  it('等待远端清单时发生的本地删除暂停整次同步', async () => {
    const { manager, ws, localDir, remote, context } = await setup({}, { 'keep.txt': 'remote', 'other.txt': 'other' });
    await manager.sync(ws);
    const before = vi.mocked(context.bisync).mock.calls.length;
    const list = context.listRemote;
    vi.spyOn(context, 'listRemote').mockImplementationOnce(async () => {
      await rm(path.join(localDir, 'keep.txt'));
      return list();
    });
    expect(await manager.sync(ws)).toMatchObject({ phase: 'confirmation_required', reason: 'deletions' });
    expect(context.bisync).toHaveBeenCalledTimes(before);
    expect(remote.get('keep.txt')).toBe('remote');
    await expect(readFile(path.join(localDir, 'keep.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('bisync 期间的编辑与删除不改变镜像，成功基线仍要求下一次删除确认', async () => {
    const { manager, ws, localDir, remote, context } = await setup({}, { 'edit.txt': 'old', 'remove.txt': 'remove' });
    await manager.sync(ws);
    const bisync = context.bisync;
    vi.mocked(context.bisync).mockImplementationOnce(async (options) => {
      const syncDir = options.localDir ?? ws.localDir;
      expect(syncDir).not.toBe(localDir);
      await writeFile(path.join(localDir, 'edit.txt'), 'user edit');
      await rm(path.join(localDir, 'remove.txt'));
      expect(await readFile(path.join(syncDir, 'edit.txt'), 'utf8')).toBe('old');
      expect(await readFile(path.join(syncDir, 'remove.txt'), 'utf8')).toBe('remove');
      await bisync(options);
    });
    expect((await manager.sync(ws)).phase).toBe('ready');
    expect(await readFile(path.join(localDir, 'edit.txt'), 'utf8')).toBe('user edit');
    await expect(readFile(path.join(localDir, 'remove.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(remote.get('edit.txt')).toBe('old');
    expect(await manager.sync(ws)).toMatchObject({ reason: 'deletions', deletions: ['remove.txt'] });
  });

  it('批准后最终远端哈希读取期间重新出现的本地文件撤销删除', async () => {
    const { manager, ws, localDir, remote, context } = await setup({}, { 'keep.txt': 'remote', 'other.txt': 'other' });
    await manager.sync(ws);
    await rm(path.join(localDir, 'keep.txt'));
    await manager.sync(ws);
    const read = context.readRemote;
    let reads = 0;
    vi.spyOn(context, 'readRemote').mockImplementation(async (file) => {
      const content = await read(file);
      if (file === 'keep.txt' && ++reads === 2) await writeFile(path.join(localDir, file), 'reappeared');
      return content;
    });
    expect((await manager.resolveDeletions(ws, 'confirm')).phase).toBe('ready');
    expect(context.deleteRemote).not.toHaveBeenCalled();
    expect(await readFile(path.join(localDir, 'keep.txt'), 'utf8')).toBe('reappeared');
    expect(remote.get('keep.txt')).toBe('reappeared');
  });

  it.each(['deletions', 'error', 'initialization', 'recovery', 'filter_changed'] as const)(
    '非冲突状态 %s 不能通过确认冲突放行执行',
    async (kind) => {
      const { manager, ws, localDir, context, remote } = await setup({}, { 'keep.txt': 'remote' });
      if (kind === 'initialization') await writeFile(path.join(localDir, 'local.txt'), 'local');
      else await manager.sync(ws);
      if (kind === 'deletions') await rm(path.join(localDir, 'keep.txt'));
      if (kind === 'error') vi.mocked(context.bisync).mockRejectedValueOnce(new Error('fixture'));
      if (kind === 'recovery') remote.clear();
      const target = kind === 'filter_changed' ? { ...ws, sync: SyncSettingsSchema.parse({ maxFileBytes: 1 }) } : ws;
      const before = await manager.sync(target);
      expect((await manager.acknowledgeConflicts(target)).phase).toBe(before.phase);
      const command = vi.fn(async () => ({ exitCode: 0 }));
      await expect(manager.execute(target, command)).rejects.toMatchObject({ code: 'sync_blocked' });
      expect(command).not.toHaveBeenCalled();
    },
  );

  it.each(['reason', 'deletions', 'conflicts'] as const)('ready 状态仍有 %s 时执行不得放行', async (pending) => {
    const { manager, ws, configDir, driver } = await setup({}, { 'keep.txt': 'remote' });
    await manager.sync(ws);
    const file = path.join(workspaceStateDir(configDir, ws.id), 'state.json');
    const state = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    if (pending === 'reason') state.reason = 'initialization';
    if (pending === 'deletions') state.deletions = ['keep.txt'];
    if (pending === 'conflicts')
      state.conflicts = [{ path: 'keep.txt', localCopy: 'local.txt', remoteCopy: 'remote.txt' }];
    await writeFile(file, JSON.stringify(state), 'utf8');
    const guarded = createSyncManager({ configDir, driver });
    const before = await guarded.status(ws);
    expect(await guarded.acknowledgeConflicts(ws)).toEqual(before);
    const command = vi.fn(async () => ({ exitCode: 0 }));
    await expect(guarded.execute(ws, command)).rejects.toMatchObject({ code: 'sync_blocked' });
    expect(command).not.toHaveBeenCalled();
  });

  it('同步期间双端同名修改保留实际双方内容并阻断执行', async () => {
    const { manager, ws, localDir, context } = await setup({}, { 'keep.txt': 'old' });
    await manager.sync(ws);
    vi.mocked(context.bisync).mockImplementationOnce(async (options) => {
      const syncDir = options.localDir ?? ws.localDir;
      await writeFile(path.join(localDir, 'keep.txt'), 'user version');
      await writeFile(path.join(syncDir, 'keep.txt'), 'remote version');
    });
    const status = await manager.sync(ws);
    expect(status.phase).toBe('conflicts');
    expect(status.conflicts).toHaveLength(1);
    const conflict = status.conflicts[0]!;
    expect(await readFile(path.join(localDir, 'keep.txt'), 'utf8')).toBe('user version');
    expect(await readFile(path.join(localDir, conflict.localCopy), 'utf8')).toBe('user version');
    expect(await readFile(path.join(localDir, conflict.remoteCopy), 'utf8')).toBe('remote version');
    await expect(manager.execute(ws, async () => ({ exitCode: 0 }))).rejects.toMatchObject({ code: 'sync_blocked' });
  });
});
