import * as fs from 'node:fs/promises';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncSettingsSchema, type Workspace } from '@ssh-server/shared';
import { workspaceStateDir } from '../../src/sync/inventory';
import { restoreTaskSnapshot, stageSnapshot } from '../../src/sync/snapshot';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, open: vi.fn(actual.open) };
});
const temps: string[] = [];
afterEach(async () => {
  vi.mocked(fs.open).mockReset();
  vi.mocked(fs.open).mockImplementation((await vi.importActual<typeof fs>('node:fs/promises')).open);
  await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
async function setup(files: Record<string, string | Buffer> = {}) {
  const dir = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR ?? os.tmpdir(), 'sync-snapshot-test-'));
  temps.push(dir);
  const localDir = path.join(dir, 'project');
  const configDir = path.join(dir, 'config');
  await fs.mkdir(localDir);
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(localDir, file)), { recursive: true });
    await fs.writeFile(path.join(localDir, file), content);
  }
  const ws: Workspace = { id: 'w1', name: 'demo', localDir, sshHost: 'my-server', remoteDir: '~/projects/demo' };
  const settings = SyncSettingsSchema.parse({ maxFileBytes: 64, excludedExtensions: ['bin'] });
  return { dir, localDir, configDir, ws, settings };
}

describe('稳定小文件镜像与受保护的回写', () => {
  it('仅复制合格文件，保留 Buffer 和 mtime，固定镜像路径并清理旧镜像', async () => {
    const input = await setup({
      'nested/a.txt': Buffer.from([0, 255, 1]),
      'skip.bin': 'skip',
      'large.txt': 'x'.repeat(65),
      '.git/config': 'git',
    });
    const source = path.join(input.localDir, 'nested/a.txt');
    const mtime = new Date('2026-01-01T00:00:00Z');
    await fs.utimes(source, mtime, mtime);
    const snapshot = await stageSnapshot(input);
    expect(snapshot.localDir).toBe(path.join(workspaceStateDir(input.configDir, input.ws.id), 'mirror'));
    expect(snapshot.inventory.map((file) => file.path)).toEqual(['nested/a.txt']);
    expect(await fs.readFile(path.join(snapshot.localDir, 'nested/a.txt'))).toEqual(Buffer.from([0, 255, 1]));
    expect((await fs.stat(path.join(snapshot.localDir, 'nested/a.txt'))).mtime.toISOString()).toBe(mtime.toISOString());
    await fs.writeFile(path.join(snapshot.localDir, 'stale.txt'), 'stale');
    expect((await stageSnapshot(input)).localDir).toBe(snapshot.localDir);
    await expect(fs.readFile(path.join(snapshot.localDir, 'stale.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(input.localDir, 'skip.bin'), 'utf8')).toBe('skip');
  });

  it.each(['delete', 'grow'] as const)('复制期间 %s 安全失败', async (change) => {
    const input = await setup({ 'a.txt': 'a', 'b.txt': 'b' });
    const open = (await vi.importActual<typeof fs>('node:fs/promises')).open;
    let changed = false;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (!changed && args[0] === path.join(input.localDir, 'a.txt')) {
        changed = true;
        if (change === 'delete') await fs.rm(path.join(input.localDir, 'b.txt'));
        else await fs.writeFile(path.join(input.localDir, 'a.txt'), 'x'.repeat(65));
      }
      return handle;
    });
    await expect(stageSnapshot(input)).rejects.toMatchObject({
      code: expect.stringMatching(/snapshot_changed|filter_changed/),
    });
  });

  it('拒绝项目符号链接，镜像清理只移除链接且不访问链接目标', async () => {
    const input = await setup({ 'a.txt': 'a' });
    const outside = path.join(input.dir, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'keep.txt'), 'outside');
    const snapshot = await stageSnapshot(input);
    await fs.symlink(outside, path.join(snapshot.localDir, 'link'), 'junction');
    await stageSnapshot(input);
    expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('outside');
    await fs.symlink(outside, path.join(input.localDir, 'link'), 'junction');
    await expect(stageSnapshot(input)).rejects.toMatchObject({ code: 'unsafe_path' });
  });

  it('镜像根目录被链接替换时拒绝清理，项目内 stateDir 也被拒绝', async () => {
    const input = await setup({ 'a.txt': 'a' });
    const snapshot = await stageSnapshot(input);
    await fs.rm(snapshot.localDir, { recursive: true });
    await fs.symlink(input.localDir, snapshot.localDir, 'junction');
    await expect(stageSnapshot(input)).rejects.toMatchObject({ code: 'unsafe_path' });
    await expect(stageSnapshot({ ...input, configDir: path.join(input.localDir, 'config') })).rejects.toMatchObject({
      code: 'unsafe_path',
    });
    expect(await fs.readFile(path.join(input.localDir, 'a.txt'), 'utf8')).toBe('a');
  });

  it('远端修改与删除仅应用到未改变的原文件，新增文件采用独占创建', async () => {
    const input = await setup({ 'edit.txt': 'old', 'delete.txt': 'delete' });
    const snapshot = await stageSnapshot(input);
    await fs.writeFile(path.join(snapshot.localDir, 'edit.txt'), 'remote');
    await fs.rm(path.join(snapshot.localDir, 'delete.txt'));
    await fs.writeFile(path.join(snapshot.localDir, 'new.txt'), 'new');
    expect(await snapshot.apply()).toEqual([]);
    expect(await fs.readFile(path.join(input.localDir, 'edit.txt'), 'utf8')).toBe('remote');
    expect(await fs.readFile(path.join(input.localDir, 'new.txt'), 'utf8')).toBe('new');
    await expect(fs.readFile(path.join(input.localDir, 'delete.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('真实文件在传输期间编辑、删除或以相同内容恢复时都保留新变化', async () => {
    const input = await setup({ 'edit.txt': 'old', 'delete.txt': 'old', 'restore.txt': 'old' });
    const snapshot = await stageSnapshot(input);
    await fs.writeFile(path.join(input.localDir, 'edit.txt'), 'user');
    await fs.rm(path.join(input.localDir, 'delete.txt'));
    await fs.rm(path.join(input.localDir, 'restore.txt'));
    await fs.writeFile(path.join(input.localDir, 'restore.txt'), 'old');
    for (const file of ['edit.txt', 'delete.txt', 'restore.txt'])
      await fs.writeFile(path.join(snapshot.localDir, file), 'remote');
    const conflicts = await snapshot.apply();
    expect(conflicts.map((conflict) => conflict.path).sort()).toEqual(['delete.txt', 'edit.txt', 'restore.txt']);
    expect(await fs.readFile(path.join(input.localDir, 'edit.txt'), 'utf8')).toBe('user');
    expect(await fs.readFile(path.join(input.localDir, 'restore.txt'), 'utf8')).toBe('old');
    await expect(fs.readFile(path.join(input.localDir, 'delete.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    for (const conflict of conflicts)
      expect(await fs.readFile(path.join(input.localDir, conflict.remoteCopy), 'utf8')).toBe('remote');
  });

  it('远端新文件与重新出现的真实内容冲突时保存两份实际版本', async () => {
    const input = await setup();
    const snapshot = await stageSnapshot(input);
    await fs.writeFile(path.join(snapshot.localDir, 'new.txt'), 'remote new');
    await fs.writeFile(path.join(input.localDir, 'new.txt'), 'user new');
    const [conflict] = await snapshot.apply();
    expect(conflict?.path).toBe('new.txt');
    expect(await fs.readFile(path.join(input.localDir, 'new.txt'), 'utf8')).toBe('user new');
    expect(await fs.readFile(path.join(input.localDir, conflict!.localCopy), 'utf8')).toBe('user new');
    expect(await fs.readFile(path.join(input.localDir, conflict!.remoteCopy), 'utf8')).toBe('remote new');
  });
});

describe('文件任务恢复后的旧空目录', () => {
  it('迁移后移除多层空父目录，保留工作区根与新路径', async () => {
    const input = await setup({ 'old/nested/script.py': 'print(1)' });
    const id = randomUUID();
    const snapshot = await stageSnapshot({ ...input, snapshotId: id });
    await fs.mkdir(path.join(snapshot.localDir, 'new'));
    await fs.rename(
      path.join(snapshot.localDir, 'old/nested/script.py'),
      path.join(snapshot.localDir, 'new/script.py'),
    );
    const restored = await restoreTaskSnapshot(input, id);
    expect(await restored.apply()).toEqual([]);
    await expect(fs.lstat(path.join(input.localDir, 'old'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.stat(input.localDir)).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(input.localDir, 'new/script.py'), 'utf8')).toBe('print(1)');
  });

  it.each(['weights.bin', 'external.txt'])('保留父目录中的排除文件或外部新增内容：%s', async (remaining) => {
    const input = await setup({ 'old/script.py': 'print(1)' });
    const id = randomUUID();
    const snapshot = await stageSnapshot({ ...input, snapshotId: id });
    await fs.rm(path.join(snapshot.localDir, 'old/script.py'));
    await fs.writeFile(path.join(input.localDir, 'old', remaining), 'keep');
    expect(await (await restoreTaskSnapshot(input, id)).apply()).toEqual([]);
    expect(await fs.readFile(path.join(input.localDir, 'old', remaining), 'utf8')).toBe('keep');
    await expect(fs.lstat(path.join(input.localDir, 'old/script.py'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('父目录被链接替换时拒绝访问，外部文件保持', async () => {
    const input = await setup({ 'old/script.py': 'print(1)' });
    const id = randomUUID();
    const snapshot = await stageSnapshot({ ...input, snapshotId: id });
    await fs.rm(path.join(snapshot.localDir, 'old/script.py'));
    const outside = path.join(input.dir, 'outside');
    await fs.rename(path.join(input.localDir, 'old'), outside);
    await fs.symlink(outside, path.join(input.localDir, 'old'), 'junction');
    await expect((await restoreTaskSnapshot(input, id)).apply()).rejects.toMatchObject({ code: 'unsafe_path' });
    expect(await fs.readFile(path.join(outside, 'script.py'), 'utf8')).toBe('print(1)');
  });

  it('普通同步删除文件仍保留空父目录', async () => {
    const input = await setup({ 'old/script.py': 'print(1)' });
    const snapshot = await stageSnapshot(input);
    await fs.rm(path.join(snapshot.localDir, 'old/script.py'));
    expect(await snapshot.apply()).toEqual([]);
    expect(await fs.readdir(path.join(input.localDir, 'old'))).toEqual([]);
  });
});
