import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_FILE_BYTES, SyncSettingsSchema, type Workspace } from '@ssh-server/shared';
import { createWorkspaceFilesService, MAX_DIRECTORY_ENTRIES } from '../../src/files/service';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, open: vi.fn(original.open) };
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
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('工作区文件服务（只读）', () => {
  it('逐级列表使用同步过滤，跳过链接和超限文件', async () => {
    const { root, ws, files } = await fixture();
    await fs.mkdir(path.join(ws.localDir, 'src'));
    await fs.mkdir(path.join(ws.localDir, '.git'));
    await fs.writeFile(path.join(ws.localDir, 'src', 'main.py'), 'print(1)\n');
    await fs.writeFile(path.join(ws.localDir, 'readme.md'), '# 项目\n');
    await fs.writeFile(path.join(ws.localDir, 'weights.pt'), 'excluded');
    await fs.writeFile(path.join(ws.localDir, 'large.txt'), Buffer.alloc(MAX_FILE_BYTES + 1));
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

  it('读取保留 UTF-8 原文、BOM 与行尾，且只返回查看所需字段', async () => {
    const { ws, files } = await fixture();
    const target = path.join(ws.localDir, 'train.py');
    const content = '\uFEFF# 中文注释\r\nprint("before")\r\n';
    await fs.writeFile(target, content, { mode: 0o750 });
    const file = await files.read(ws, 'train.py');
    expect(file).toEqual({ path: 'train.py', content, size: Buffer.byteLength(content) });
    expect(Object.keys(file).sort()).toEqual(['content', 'path', 'size']);
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
    await expect(files.read(ws, 'link.txt')).rejects.toMatchObject({ code: 'unsafe_path' });
    await expect(files.list({ ...ws, localDir: path.join(ws.localDir, 'link-dir') })).rejects.toMatchObject({
      code: 'unsafe_path',
    });
    expect(await fs.readFile(path.join(outside, 'source.txt'), 'utf8')).toBe('untouched');
  });

  it('只查看有效 UTF-8 文本，拒绝二进制与非法编码', async () => {
    const { ws, files } = await fixture();
    const target = path.join(ws.localDir, 'data.txt');
    for (const bytes of [Buffer.from([0, 1, 2]), Buffer.from([0xc3, 0x28])]) {
      await fs.writeFile(target, bytes);
      await expect(files.read(ws, 'data.txt')).rejects.toMatchObject({ code: 'invalid_text' });
    }
    await fs.writeFile(target, '');
    expect((await files.read(ws, 'data.txt')).content).toBe('');
  });

  it('同步大小阈值与 2 MiB 查看上限按字节数生效，且不隐式创建文件', async () => {
    const { ws, files } = await fixture();
    const limited = { ...ws, sync: SyncSettingsSchema.parse({ maxFileBytes: 4 }) };
    await fs.writeFile(path.join(ws.localDir, 'small.txt'), 'one\n');
    expect((await files.read(limited, 'small.txt')).size).toBe(4);
    await fs.writeFile(path.join(ws.localDir, 'small.txt'), 'three\n');
    await expect(files.read(limited, 'small.txt')).rejects.toMatchObject({ code: 'too_large' });
    await fs.writeFile(path.join(ws.localDir, 'large.txt'), Buffer.alloc(MAX_FILE_BYTES + 1));
    await expect(files.read(ws, 'large.txt')).rejects.toMatchObject({ code: 'too_large' });
    await expect(files.read(ws, 'missing.txt')).rejects.toMatchObject({ code: 'not_found' });
    await expect(fs.stat(path.join(ws.localDir, 'missing.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('读取期间文件被替换时丢弃该次快照，不返回混合内容', async () => {
    const { ws, files } = await fixture();
    const target = path.join(ws.localDir, 'main.py');
    await fs.writeFile(target, 'before\n');
    const actualOpen = vi.mocked(fs.open).getMockImplementation()!;
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const handle = await actualOpen(...args);
      await fs.writeFile(target, 'external\n');
      return handle;
    });
    await expect(files.read(ws, 'main.py')).rejects.toMatchObject({ code: 'invalid_text' });
    expect(await fs.readFile(target, 'utf8')).toBe('external\n');
    expect((await files.read(ws, 'main.py')).content).toBe('external\n');
  });
});
