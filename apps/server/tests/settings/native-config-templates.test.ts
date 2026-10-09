import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach, expect, it } from 'vitest';
import { createNativeConfigService, type NativeConfigAgent } from '../../src/settings/native-config';
import { nativeConfigTemplate } from '../../../web/src/features/settings/native-config-templates';

const roots: string[] = [];
async function fixture(agent: NativeConfigAgent) {
  const homeDir = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR ?? os.tmpdir(), 'native-template-'));
  roots.push(homeDir);
  const directory = path.join(homeDir, `.${agent}`);
  const basename = agent === 'claude' ? 'settings.json' : 'config.toml';
  return {
    homeDir,
    directory,
    basename,
    file: path.join(directory, basename),
    service: createNativeConfigService({ homeDir, env: {} }),
  };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it.each(['claude', 'codex'] as const)(
  '%s 模板不读取或创建磁盘配置，明确保存才原子创建且默认无覆盖项',
  async (agent) => {
    const f = await fixture(agent);
    const before = await f.service.read(agent);
    expect(before).toMatchObject({ content: '', exists: false, revision: 'missing' });
    expect(await fs.readdir(f.homeDir)).toEqual([]);
    const draft = nativeConfigTemplate(agent);
    const parsed: unknown = agent === 'claude' ? JSON.parse(draft.content) : parseToml(draft.content);
    expect(parsed).toEqual({});
    expect(await fs.readdir(f.homeDir)).toEqual([]);
    expect(await f.service.read(agent)).toEqual(before);
    const saved = await f.service.save(agent, { content: draft.content, revision: before.revision });
    expect(saved.exists).toBe(true);
    expect(saved.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(await fs.readFile(f.file, 'utf8')).toBe(draft.content);
    expect(await fs.readdir(f.directory)).toEqual([f.basename]);
  },
);

it.each(['claude', 'codex'] as const)('%s 模板期间外部新建配置返回409，保留外部内容和未保存草稿', async (agent) => {
  const f = await fixture(agent);
  const before = await f.service.read(agent);
  const draft = nativeConfigTemplate(agent).content;
  const external = agent === 'claude' ? '{"model":"external-model"}\n' : 'model = "external-model"\n';
  await fs.mkdir(f.directory);
  await fs.writeFile(f.file, external, { encoding: 'utf8' });
  await expect(f.service.save(agent, { content: draft, revision: before.revision })).rejects.toMatchObject({
    code: 'revision_conflict',
    status: 409,
  });
  expect(await fs.readFile(f.file, 'utf8')).toBe(external);
  expect(draft).not.toBe(external);
  expect(await fs.readdir(f.directory)).toEqual([f.basename]);
});

it.each(['claude', 'codex'] as const)(
  '%s 空文件有独立修订，不能用missing模板覆盖，使用读取修订才可保存',
  async (agent) => {
    const f = await fixture(agent);
    await fs.mkdir(f.directory);
    await fs.writeFile(f.file, '', { encoding: 'utf8' });
    const before = await f.service.read(agent);
    expect(before).toMatchObject({ exists: true, content: '' });
    expect(before.revision).not.toBe('missing');
    const { content } = nativeConfigTemplate(agent);
    await expect(f.service.save(agent, { content, revision: 'missing' })).rejects.toMatchObject({ status: 409 });
    expect(await fs.readFile(f.file, 'utf8')).toBe('');
    await f.service.save(agent, { content, revision: before.revision });
    expect(await fs.readFile(f.file, 'utf8')).toBe(content);
  },
);

it('Codex 可选model与effort取消注释后仍为合法TOML，且只写入显式选择', async () => {
  const f = await fixture('codex');
  const content = nativeConfigTemplate('codex')
    .content.replace('# model = "your-model-id"', 'model = "demo-model"')
    .replace('# model_reasoning_effort = "medium"', 'model_reasoning_effort = "medium"');
  expect(parseToml(content)).toEqual({ model: 'demo-model', model_reasoning_effort: 'medium' });
  await f.service.save('codex', { content, revision: 'missing' });
  expect(await fs.readFile(f.file, 'utf8')).toBe(content);
});
