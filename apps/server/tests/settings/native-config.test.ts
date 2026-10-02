import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeConfigError } from '../../src/settings/errors';
import { createNativeConfigService, type NativeConfigAgent } from '../../src/settings/native-config';
import { MAX_CONFIG_BYTES } from '../../src/settings/safe-file';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return { ...original, open: vi.fn(original.open), rename: vi.fn(original.rename) };
});

const roots: string[] = [];
async function fixture() {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
  roots.push(homeDir);
  return { homeDir, service: createNativeConfigService({ homeDir, env: {} }) };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.open).mockReset();
  vi.mocked(fs.rename).mockReset();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('原生 Agent 配置', () => {
  it.each([
    ['claude', 'settings.json', '\uFEFF{\n  "unknown": { "enabled": true },\n  "env": {}\n}\n'],
    ['codex', 'config.toml', '# 保留注释\r\nmodel = "example"\r\n[unknown]\r\nenabled = true\r\n'],
  ] as const)('%s 原文读取、原子保存并保留未知字段与格式', async (agent, basename, content) => {
    const { homeDir, service } = await fixture();
    const directory = path.join(homeDir, `.${agent}`);
    const file = path.join(directory, basename);
    await fs.mkdir(directory);
    await fs.writeFile(file, content);
    const before = await service.read(agent);
    expect(before).toMatchObject({ agent, content, exists: true, displayPath: `~/.${agent}/${basename}` });
    expect(before.revision).toMatch(/^[a-f0-9]{64}$/);
    const next = content.replace('true', 'false');
    const saved = await service.save(agent, { content: next, revision: before.revision });
    expect(saved.content).toBe(next);
    expect(saved.revision).not.toBe(before.revision);
    expect((await service.read(agent)).revision).toBe(saved.revision);
    expect(await fs.readFile(file, 'utf8')).toBe(next);
    expect(await fs.readdir(directory)).toEqual([basename]);
    if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it('固定原生文件名，按环境目录读取，缺失文件可新建', async () => {
    const { homeDir, service } = await fixture();
    expect(await service.read('claude')).toMatchObject({ exists: false, content: '', revision: 'missing' });
    await service.save('claude', { content: '{}', revision: 'missing' });
    expect(await fs.readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8')).toBe('{}');
    const env = {
      CLAUDE_CONFIG_DIR: path.join(homeDir, 'custom-claude'),
      CODEX_HOME: path.join(homeDir, 'custom-codex'),
    };
    const overridden = createNativeConfigService({ homeDir, env });
    await overridden.save('claude', { content: '{"extra":1}', revision: 'missing' });
    await overridden.save('codex', { content: '# 新配置\nmodel = "example"\n', revision: 'missing' });
    expect(await fs.readdir(env.CLAUDE_CONFIG_DIR)).toEqual(['settings.json']);
    expect(await fs.readdir(env.CODEX_HOME)).toEqual(['config.toml']);
    expect((await overridden.read('codex')).displayPath).toBe(path.join(env.CODEX_HOME, 'config.toml'));
  });

  it('无效 JSON 根结构与 TOML 语法均拒绝，错误不含原文', async () => {
    const { service } = await fixture();
    const cases: [NativeConfigAgent, string][] = [
      ['claude', '["secret-sentinel"]'],
      ['claude', 'null'],
      ['claude', '{"secret-sentinel":'],
      ['codex', 'token = "secret-sentinel"\ntoken = "duplicate"'],
    ];
    for (const [agent, content] of cases) {
      const error: unknown = await service
        .save(agent, { content, revision: 'missing' })
        .catch((value: unknown) => value);
      expect(error).toBeInstanceOf(NativeConfigError);
      expect(error).toMatchObject({ code: agent === 'claude' ? 'invalid_json' : 'invalid_toml', status: 400 });
      expect(String(error)).not.toContain('secret-sentinel');
      expect((await service.read(agent)).exists).toBe(false);
    }
  });

  it('无效 UTF-8 与无法无损编码的输入均拒绝', async () => {
    const { homeDir, service } = await fixture();
    const directory = path.join(homeDir, '.codex');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'config.toml'), Buffer.from([0xc3, 0x28]));
    await expect(service.read('codex')).rejects.toMatchObject({ code: 'invalid_utf8' });
    await expect(service.save('claude', { content: '{"token":"\uD800"}', revision: 'missing' })).rejects.toMatchObject({
      code: 'invalid_utf8',
    });
  });

  it('读写按字节限制大小，目录及非普通文件均拒绝', async () => {
    const { homeDir, service } = await fixture();
    await expect(
      service.save('claude', {
        content: JSON.stringify({ text: '界'.repeat(MAX_CONFIG_BYTES / 2) }),
        revision: 'missing',
      }),
    ).rejects.toMatchObject({ code: 'too_large', status: 413 });
    const directory = path.join(homeDir, '.codex');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'config.toml'), Buffer.alloc(MAX_CONFIG_BYTES + 1, 32));
    await expect(service.read('codex')).rejects.toMatchObject({ code: 'too_large' });
    await fs.mkdir(path.join(homeDir, '.claude', 'settings.json'), { recursive: true });
    await expect(service.read('claude')).rejects.toMatchObject({ code: 'unsafe_path' });
    await expect(service.save('claude', { content: '{}', revision: 'missing' })).rejects.toMatchObject({
      code: 'unsafe_path',
    });
    const notDirectory = path.join(homeDir, 'not-directory');
    await fs.writeFile(notDirectory, '');
    const blocked = createNativeConfigService({ homeDir, env: { CODEX_HOME: notDirectory } });
    await expect(blocked.read('codex')).rejects.toMatchObject({ code: 'unsafe_path' });
  });

  it('外部修改拒绝覆盖；同一修订的并发保存仅接受一个', async () => {
    const { homeDir, service } = await fixture();
    const initial = await service.save('codex', { content: 'version = 1\n', revision: 'missing' });
    const file = path.join(homeDir, '.codex', 'config.toml');
    await fs.writeFile(file, 'version = 2\n');
    await expect(service.save('codex', { content: 'version = 3\n', revision: initial.revision })).rejects.toMatchObject(
      {
        code: 'revision_conflict',
      },
    );
    expect(await fs.readFile(file, 'utf8')).toBe('version = 2\n');
    const current = await service.read('codex');
    const results = await Promise.allSettled([
      service.save('codex', { content: 'version = 3\n', revision: current.revision }),
      service.save('codex', { content: 'version = 4\n', revision: current.revision }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(results[1]).toMatchObject({ reason: { code: 'revision_conflict' } });
    expect(await fs.readFile(file, 'utf8')).toBe('version = 3\n');
  });

  it('拒绝配置目录与文件链接，保持链接目标内容', async () => {
    const { homeDir, service } = await fixture();
    const outside = path.join(homeDir, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'settings.json'), '{}');
    await fs.symlink(outside, path.join(homeDir, '.claude'), 'junction');
    await expect(service.read('claude')).rejects.toMatchObject({ code: 'unsafe_path' });
    await expect(service.save('claude', { content: '{}', revision: 'missing' })).rejects.toMatchObject({
      code: 'unsafe_path',
    });
    await fs.mkdir(path.join(homeDir, '.codex'));
    const target = path.join(outside, 'config.toml');
    await fs.writeFile(target, 'untouched = true\n');
    await fs.symlink(target, path.join(homeDir, '.codex', 'config.toml'), 'file');
    await expect(service.read('codex')).rejects.toMatchObject({ code: 'unsafe_path' });
    await expect(service.save('codex', { content: '', revision: 'missing' })).rejects.toMatchObject({
      code: 'unsafe_path',
    });
    expect(await fs.readFile(target, 'utf8')).toBe('untouched = true\n');
  });

  it('临时文件写入期间发生外部修改时，替换前再次拒绝并清理临时文件', async () => {
    const { homeDir, service } = await fixture();
    const current = await service.save('codex', { content: 'version = 1\n', revision: 'missing' });
    const directory = path.join(homeDir, '.codex');
    const file = path.join(directory, 'config.toml');
    const actualOpen = vi.mocked(fs.open).getMockImplementation()!;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await actualOpen(...args);
      if (String(args[0]).endsWith('.tmp')) {
        const actualSync = handle.sync.bind(handle);
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          await actualSync();
          await fs.writeFile(file, 'version = 9\n');
        });
      }
      return handle;
    });
    await expect(service.save('codex', { content: 'version = 2\n', revision: current.revision })).rejects.toMatchObject(
      {
        code: 'revision_conflict',
      },
    );
    expect(await fs.readFile(file, 'utf8')).toBe('version = 9\n');
    expect(await fs.readdir(directory)).toEqual(['config.toml']);
  });

  it('系统写入错误匿名返回，原文件未改变且不保留临时副本', async () => {
    const { homeDir, service } = await fixture();
    const current = await service.save('claude', { content: '{}\n', revision: 'missing' });
    vi.mocked(fs.rename).mockRejectedValue(new Error('secret-sentinel'));
    await expect(service.save('claude', { content: '{"updated":true}\n', revision: current.revision })).rejects.toEqual(
      new NativeConfigError('io_error'),
    );
    const directory = path.join(homeDir, '.claude');
    expect(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).toBe('{}\n');
    expect(await fs.readdir(directory)).toEqual(['settings.json']);
  });
});
