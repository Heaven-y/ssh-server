import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_EDITABLE_FILE_BYTES, SyncSettingsSchema, type Workspace } from '@ssh-server/shared';
import { WorkspaceFileError } from '../../src/files/errors';
import { createWorkspaceFilesService, MAX_DIRECTORY_ENTRIES } from '../../src/files/service';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, open: vi.fn(original.open), rename: vi.fn(original.rename) };
});

const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-files-'));
  roots.push(root);
  const localDir = path.join(root, 'project');
  await fs.mkdir(localDir);
  const ws: Workspace = { id: 'w1', name: 'demo', localDir, sshHost: 'my-server', remoteDir: '~/projects/demo' };
  return { root, ws, files: createWorkspaceFilesService() };
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.open).mockReset();
  vi.mocked(fs.rename).mockReset();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('工作区文件服务', () => {
  it('逐级列表使用同步过滤，跳过链接和超限文件', async () => {
    const { root, ws, files } = await fixture();
    await fs.mkdir(path.join(ws.localDir, 'src'));
    await fs.mkdir(path.join(ws.localDir, '.git'));
    await fs.writeFile(path.join(ws.localDir, 'src', 'main.py'), 'print(1)\n');
    await fs.writeFile(path.join(ws.localDir, 'readme.md'), '# 项目\n');
    await fs.writeFile(path.join(ws.localDir, 'weights.pt'), 'excluded');
    await fs.writeFile(path.join(ws.localDir, 'large.txt'), Buffer.alloc(MAX_EDITABLE_FILE_BYTES + 1));
    await fs.symlink(root, path.join(ws.localDir, 'linked'), 'junction');
    expect(await files.list(ws)).toEqual({
      path: '',
      entries: [
        { path: 'src', name: 'src', kind: 'directory' },
        { path: 'readme.md', name: 'readme.md', kind: 'file', size: Buffer.byteLength('# 项目\n') },
      ],
      truncated: false,
    });
    expect((await files.list(ws, 'src')).entries).toEqual([
      { path: 'src/main.py', name: 'main.py', kind: 'file', size: 9 },
    ]);
    const filtered = { ...ws, sync: SyncSettingsSchema.parse({ excludedExtensions: ['md'] }) };
    expect((await files.list(filtered)).entries.map((entry) => entry.name)).toEqual(['src', 'weights.pt']);
  });

  it('目录数量达到上限时明确标记截断', async () => {
    const { ws, files } = await fixture();
    await Promise.all(
      Array.from({ length: MAX_DIRECTORY_ENTRIES + 1 }, (_, index) => fs.mkdir(path.join(ws.localDir, `dir-${index}`))),
    );
    const result = await files.list(ws);
    expect(result.entries).toHaveLength(MAX_DIRECTORY_ENTRIES);
    expect(result.truncated).toBe(true);
  });

  it('读取、revision 与保存保留 UTF-8 原文、BOM、行尾和文件权限', async () => {
    const { ws, files } = await fixture();
    const target = path.join(ws.localDir, 'train.py');
    const content = '\uFEFF# 中文注释\r\nprint("before")\r\n';
    await fs.writeFile(target, content, { mode: 0o750 });
    const permissions = (await fs.stat(target)).mode & 0o777;
    const initial = await files.read(ws, 'train.py');
    expect(initial).toMatchObject({ path: 'train.py', content, size: Buffer.byteLength(content) });
    expect(await files.revision(ws, 'train.py')).toEqual({ revision: initial.revision });
    const next = content.replace('before', 'after');
    const saved = await files.save(ws, { path: 'train.py', content: next, revision: initial.revision });
    expect(saved.revision).not.toBe(initial.revision);
    expect(await fs.readFile(target, 'utf8')).toBe(next);
    expect((await fs.stat(target)).mode & 0o777).toBe(permissions);
    expect(await fs.readdir(ws.localDir)).toEqual(['train.py']);
  });

  it('拒绝越界、设备名、被排除路径、文件链接和目录链接', async () => {
    const { root, ws, files } = await fixture();
    for (const relative of ['../secret.txt', '/escape', 'a\\b', 'a//b', 'a:stream', 'CON', 'COM¹', 'tab\tname']) {
      await expect(files.read(ws, relative)).rejects.toMatchObject({ code: 'unsafe_path' });
    }
    for (const relative of ['.git/config', 'model.pt', 'nested/.git/file']) {
      await expect(files.read(ws, relative)).rejects.toMatchObject({ code: 'excluded' });
    }
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'source.txt'), 'untouched');
    await fs.symlink(outside, path.join(ws.localDir, 'link-dir'), 'junction');
    await fs.symlink(path.join(outside, 'source.txt'), path.join(ws.localDir, 'link.txt'), 'file');
    await expect(files.list(ws, 'link-dir')).rejects.toMatchObject({ code: 'unsafe_path' });
    await expect(files.read(ws, 'link-dir/source.txt')).rejects.toMatchObject({ code: 'unsafe_path' });
    await expect(files.save(ws, { path: 'link.txt', content: 'new', revision: 'a'.repeat(64) })).rejects.toMatchObject({
      code: 'unsafe_path',
    });
    await expect(files.list({ ...ws, localDir: path.join(ws.localDir, 'link-dir') })).rejects.toMatchObject({
      code: 'unsafe_path',
    });
    expect(await fs.readFile(path.join(outside, 'source.txt'), 'utf8')).toBe('untouched');
  });

  it('只编辑有效 UTF-8 文本，拒绝二进制、非法编码和不可无损保存的输入', async () => {
    const { ws, files } = await fixture();
    const target = path.join(ws.localDir, 'data.txt');
    for (const bytes of [Buffer.from([0, 1, 2]), Buffer.from([0xc3, 0x28])]) {
      await fs.writeFile(target, bytes);
      await expect(files.read(ws, 'data.txt')).rejects.toMatchObject({ code: 'invalid_text' });
    }
    await fs.writeFile(target, '');
    const initial = await files.read(ws, 'data.txt');
    expect(initial.content).toBe('');
    for (const content of ['bad\0text', '\uD800']) {
      await expect(files.save(ws, { ...initial, content })).rejects.toMatchObject({ code: 'invalid_text' });
    }
    expect(await fs.readFile(target, 'utf8')).toBe('');
  });

  it('同步大小阈值与 2 MiB 编辑上限按 UTF-8 字节数生效，不隐式创建文件', async () => {
    const { ws, files } = await fixture();
    const limited = { ...ws, sync: SyncSettingsSchema.parse({ maxFileBytes: 4 }) };
    const target = path.join(ws.localDir, 'small.txt');
    await fs.writeFile(target, 'one\n');
    const initial = await files.read(limited, 'small.txt');
    await expect(files.save(limited, { ...initial, content: '中文' })).rejects.toMatchObject({ code: 'too_large' });
    await fs.writeFile(target, 'three\n');
    await expect(files.read(limited, 'small.txt')).rejects.toMatchObject({ code: 'too_large' });
    await fs.writeFile(path.join(ws.localDir, 'large.txt'), Buffer.alloc(MAX_EDITABLE_FILE_BYTES + 1));
    await expect(files.read(ws, 'large.txt')).rejects.toMatchObject({ code: 'too_large' });
    await expect(files.save(ws, { path: 'missing.txt', content: '', revision: 'a'.repeat(64) })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(fs.stat(path.join(ws.localDir, 'missing.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('外部修改不覆盖，同一版本的并发保存只有一个成功', async () => {
    const { ws, files } = await fixture();
    const target = path.join(ws.localDir, 'main.py');
    await fs.writeFile(target, 'before\n');
    const before = await files.read(ws, 'main.py');
    await fs.writeFile(target, 'external\n');
    await expect(files.save(ws, { ...before, content: 'mine\n' })).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await fs.readFile(target, 'utf8')).toBe('external\n');
    const current = await files.read(ws, 'main.py');
    const results = await Promise.allSettled([
      files.save(ws, { ...current, content: 'first\n' }),
      files.save(ws, { ...current, content: 'second\n' }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(results[1]).toMatchObject({ reason: { code: 'revision_conflict' } });
    expect(await fs.readFile(target, 'utf8')).toBe('first\n');
  });

  it('写入期间发生外部修改时替换前再次检测，并清理临时文件', async () => {
    const { ws, files } = await fixture();
    const target = path.join(ws.localDir, 'main.py');
    await fs.writeFile(target, 'before\n');
    const current = await files.read(ws, 'main.py');
    const actualOpen = vi.mocked(fs.open).getMockImplementation()!;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await actualOpen(...args);
      if (String(args[0]).endsWith('.tmp')) {
        const actualSync = handle.sync.bind(handle);
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          await actualSync();
          await fs.writeFile(target, 'external\n');
        });
      }
      return handle;
    });
    await expect(files.save(ws, { ...current, content: 'mine\n' })).rejects.toMatchObject({
      code: 'revision_conflict',
    });
    expect(await fs.readFile(target, 'utf8')).toBe('external\n');
    expect(await fs.readdir(ws.localDir)).toEqual(['main.py']);
  });

  it('底层写入失败匿名返回，不改变原文件且清理临时内容', async () => {
    const { ws, files } = await fixture();
    const target = path.join(ws.localDir, 'main.py');
    await fs.writeFile(target, 'before\n');
    const current = await files.read(ws, 'main.py');
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('secret-sentinel'));
    await expect(files.save(ws, { ...current, content: 'after\n' })).rejects.toEqual(
      new WorkspaceFileError('io_error'),
    );
    expect(await fs.readFile(target, 'utf8')).toBe('before\n');
    expect(await fs.readdir(ws.localDir)).toEqual(['main.py']);
  });
});
