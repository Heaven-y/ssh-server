import path from 'node:path';
import type { FileEntryWithStats, Stats } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncSettingsSchema } from '@ssh-server/shared';
import type { SftpReader } from '../../src/ssh/sftp';
import { createDirectoryCursor } from '../../src/remote-files/directory';
import { directoryEntry, remotePath } from '../../src/remote-files/paths';

const root = path.posix.join(path.posix.sep, 'fixture-home', 'project');
const settings = SyncSettingsSchema.parse({});
const entry = (name: string, type = 'file', size = 4): FileEntryWithStats => ({
  filename: name,
  longname: '',
  attrs: {
    size,
    mtime: 1,
    isFile: () => type === 'file',
    isDirectory: () => type === 'directory',
    isSymbolicLink: () => type === 'link',
  } as Stats,
});
function fixture(batches: Array<FileEntryWithStats[] | false | Error>) {
  const controller = new AbortController();
  const reader: SftpReader = {
    signal: controller.signal,
    close: vi.fn(() => controller.abort()),
    realpath: vi.fn(),
    lstat: vi.fn(),
    fstat: vi.fn(),
    opendir: vi.fn(),
    readdir: vi.fn(async () => {
      const next = batches.shift() ?? false;
      if (next instanceof Error) throw next;
      return next;
    }),
    closeHandle: vi.fn(async () => undefined),
  };
  const cursor = createDirectoryCursor(reader, Buffer.from('directory-handle'), { directory: root, root, settings });
  cleanups.push(() => cursor.close());
  return { reader, cursor };
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
  vi.useRealTimers();
});

describe('SFTP 分页与范围', () => {
  it('保留跨批条目，EOF 后重试同一游标返回同一页', async () => {
    const items = Array.from({ length: 320 }, (_, i) => entry(`file-${i}`));
    const { reader, cursor } = fixture([
      items.slice(0, 80),
      items.slice(80, 160),
      items.slice(160, 240),
      items.slice(240),
      false,
    ]);
    const first = await cursor.page();
    const second = await cursor.page(first.nextCursor);
    expect(first.entries.map((item) => item.name)).toEqual(items.slice(0, 200).map((item) => item.filename));
    expect(second.entries.map((item) => item.name)).toEqual(items.slice(200).map((item) => item.filename));
    expect(second.nextCursor).toBeUndefined();
    expect(await cursor.page(first.nextCursor)).toEqual(second);
    expect(reader.readdir).toHaveBeenCalledTimes(5);
    expect(reader.closeHandle).toHaveBeenCalledOnce();
  });

  it('完整目录读取失败时不返回半份有序列表，游标随即失效', async () => {
    const items = Array.from({ length: 240 }, (_, i) => entry(`file-${i}`));
    const { reader, cursor } = fixture([items, new Error('fixture-private-diagnostic')]);
    await expect(cursor.page()).rejects.toMatchObject({ code: 'cursor_expired' });
    await expect(cursor.page()).rejects.toMatchObject({ code: 'cursor_expired' });
    expect(reader.readdir).toHaveBeenCalledTimes(2);
    expect(reader.signal.aborted).toBe(true);
  });

  it('读取完成释放远端句柄，临近空闲期限翻页仍可读取有序快照', async () => {
    vi.useFakeTimers();
    const { reader, cursor } = fixture([Array.from({ length: 201 }, (_, i) => entry(`file-${i}`))]);
    const first = await cursor.page();
    expect(reader.closeHandle).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(59_000);
    const next = await cursor.page(first.nextCursor);
    expect(next.entries.map((item) => item.name)).toEqual(['file-200']);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await cursor.page(first.nextCursor)).toEqual(next);
    expect(reader.closeHandle).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_001);
    await expect(cursor.page(first.nextCursor)).rejects.toMatchObject({ code: 'cursor_expired' });
  });

  it('分页前全局文件夹优先，按名称自然排序且保留大小写不同的条目', async () => {
    const files = Array.from({ length: 201 }, (_, i) => entry(`file${201 - i}`));
    const { cursor } = fixture([files, [entry('z10', 'directory'), entry('z2', 'directory'), entry('File2')]]);
    const first = await cursor.page();
    const second = await cursor.page(first.nextCursor);
    expect(first.entries.slice(0, 6).map((item) => item.name)).toEqual([
      'z2',
      'z10',
      'file1',
      'File2',
      'file2',
      'file3',
    ]);
    expect(second.entries.map((item) => item.name)).toEqual(['file198', 'file199', 'file200', 'file201']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('单目录超过有界排序容量则拒绝展示并释放句柄', async () => {
    const { reader, cursor } = fixture([Array.from({ length: 10_001 }, (_, i) => entry(`file${i}`))]);
    await expect(cursor.page()).rejects.toMatchObject({ code: 'directory_too_large' });
    expect(reader.closeHandle).toHaveBeenCalledOnce();
    expect(reader.signal.aborted).toBe(true);
  });

  it('远端合法名称和大文件仍能显示，同步范围按既有规则单独判断', () => {
    expect(directoryEntry(entry('train.py'), root, root, settings)?.scope).toBe('included');
    expect(directoryEntry(entry('train:1.py'), root, root, settings)?.scope).toBe('unsupported');
    expect(directoryEntry(entry('weights.bin', 'file', 20 * 1024 ** 3), root, root, settings)?.scope).toBe('excluded');
    expect(directoryEntry(entry('.git', 'directory'), root, root, settings)?.scope).toBe('excluded');
    expect(directoryEntry(entry('data', 'link'), root, root, settings)?.scope).toBe('link');
    const home = path.posix.dirname(root);
    expect(remotePath('../datasets', root, home)).toBe(path.posix.join(home, 'datasets'));
    expect(directoryEntry(entry('train.py'), home, root, settings)?.scope).toBe('outside');
    expect(remotePath('~', root, home)).toBe(home);
    expect(() => remotePath('~another-user', root, home)).toThrow('路径');
  });
});
