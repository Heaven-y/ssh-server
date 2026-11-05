import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { parse } from 'smol-toml';
import { createModelSettingsService } from '../../src/settings/model-settings';
import { createNativeResourcesService } from '../../src/settings/native-resources';

const roots: string[] = [];
async function fixture() {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'model-settings-'));
  roots.push(homeDir);
  const service = createModelSettingsService({ resources: createNativeResourcesService({ homeDir, env: {} }) });
  const write = async (relative: string, content: string) => {
    const file = path.join(homeDir, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    return file;
  };
  return { service, write };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('Claude 表单隐藏密钥，空白保留，明确清除，仅改原生字段并保留未知配置', async () => {
  const { service, write } = await fixture();
  const file = await write(
    '.claude/settings.json',
    JSON.stringify({
      model: 'old',
      env: { ANTHROPIC_AUTH_TOKEN: 'sentinel-secret', EXTRA: 'keep' },
      permissions: { allow: ['Read'] },
    }),
  );
  const initial = await service.read('claude');
  expect(JSON.stringify(initial)).not.toContain('sentinel-secret');
  expect(initial.fields.find((field) => field.key === 'authToken')).toMatchObject({ value: '', hasValue: true });
  const saved = await service.save('claude', {
    revision: initial.revision,
    changes: { model: 'sonnet', sonnetModel: 'custom-sonnet', authToken: '' },
  });
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
    model: 'sonnet',
    env: { ANTHROPIC_AUTH_TOKEN: 'sentinel-secret', EXTRA: 'keep', ANTHROPIC_DEFAULT_SONNET_MODEL: 'custom-sonnet' },
    permissions: { allow: ['Read'] },
  });
  await service.save('claude', { revision: saved.revision, changes: { authToken: null } });
  expect(await fs.readFile(file, 'utf8')).not.toContain('sentinel-secret');
});

it('Codex 保留注释和其他服务商，API Key 写入所选原生 provider，认证切换清理冲突字段', async () => {
  const { service, write } = await fixture();
  const file = await write(
    '.codex/config.toml',
    '# 保留这段注释\nmodel = "old"\n[model_providers.existing]\nname = "Existing"\nenv_key = "EXISTING_KEY"\n[features]\nkeep = true\n',
  );
  const initial = await service.read('codex');
  const saved = await service.save('codex', {
    revision: initial.revision,
    changes: {
      provider: 'agentdeck',
      model: 'custom-model',
      baseUrl: 'https://example.test/v1',
      apiKey: 'sentinel-key',
    },
  });
  const content = await fs.readFile(file, 'utf8');
  expect(content).toContain('# 保留这段注释');
  expect(parse(content)).toMatchObject({
    model: 'custom-model',
    model_provider: 'agentdeck',
    model_providers: {
      existing: { env_key: 'EXISTING_KEY' },
      agentdeck: {
        experimental_bearer_token: 'sentinel-key',
        wire_api: 'responses',
        base_url: 'https://example.test/v1',
      },
    },
    features: { keep: true },
  });
  expect(JSON.stringify(saved)).not.toContain('sentinel-key');
  await service.save('codex', { revision: saved.revision, changes: { authMode: 'env', envKey: 'MY_MODEL_KEY' } });
  expect(await fs.readFile(file, 'utf8')).not.toContain('sentinel-key');
  expect(parse(await fs.readFile(file, 'utf8'))).toMatchObject({
    model_providers: { agentdeck: { env_key: 'MY_MODEL_KEY', requires_openai_auth: false } },
  });
});

it('已有高级认证拒绝被简单 Key 表单覆盖，模型与地址仍可独立编辑', async () => {
  const { service, write } = await fixture();
  const original =
    'model_provider = "external"\n[model_providers.external]\nname = "External"\n[model_providers.external.auth]\ncommand = "native-token-helper"\n';
  const file = await write('.codex/config.toml', original);
  const initial = await service.read('codex');
  await expect(
    service.save('codex', { revision: initial.revision, changes: { apiKey: 'must-not-write' } }),
  ).rejects.toThrow('高级认证');
  expect(await fs.readFile(file, 'utf8')).toBe(original);
  await service.save('codex', { revision: initial.revision, changes: { model: 'custom-model' } });
  expect(parse(await fs.readFile(file, 'utf8'))).toMatchObject({
    model: 'custom-model',
    model_providers: { external: { auth: { command: 'native-token-helper' } } },
  });
});

it.each([
  'http_headers = { authorization = "sentinel-header" }',
  'gateway_oauth = { issuer = "example" }',
  'aws = { region = "example" }',
])('高级认证 %s 不允许新增冲突 Key', async (auth) => {
  const { service, write } = await fixture();
  const original = `model_provider = "external"\n[model_providers.external]\nname = "External"\n${auth}\n`;
  const file = await write('.codex/config.toml', original);
  const initial = await service.read('codex');
  expect(
    initial.providers?.find((entry) => entry.id === 'external')?.fields.find((field) => field.key === 'authMode')
      ?.value,
  ).toBe('command');
  await expect(
    service.save('codex', { revision: initial.revision, changes: { apiKey: 'must-not-write' } }),
  ).rejects.toThrow('高级认证');
  expect(await fs.readFile(file, 'utf8')).toBe(original);
});

it.each(['ollama', 'lmstudio'])('内置服务商 %s 不生成冲突的自定义服务商定义', async (provider) => {
  const { service, write } = await fixture();
  const file = await write('.codex/config.toml', `model_provider = "${provider}"\n`);
  const initial = await service.read('codex');
  await service.save('codex', { revision: initial.revision, changes: { provider, model: 'local-model' } });
  expect(parse(await fs.readFile(file, 'utf8'))).toEqual({ model_provider: provider, model: 'local-model' });
});

it('Antigravity 只保存实际支持的模型与连接方式，不写伪造的 URL 或 Key 字段', async () => {
  const { service, write } = await fixture();
  const file = await write(
    '.gemini/antigravity-cli/settings.json',
    '{"customModelsConfig":{"customModels":[{"modelName":"gemini-api://example.test/models/custom","label":"Custom"}]}}',
  );
  const initial = await service.read('antigravity');
  await expect(
    service.save('antigravity', { revision: initial.revision, changes: { apiKey: 'must-not-write' } }),
  ).rejects.toThrow('不支持');
  const saved = await service.save('antigravity', {
    revision: initial.revision,
    changes: { model: 'Custom', modelProvider: 'gemini' },
  });
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toMatchObject({
    model: 'Custom',
    modelProvider: 'gemini',
    customModelsConfig: { customModels: [{ label: 'Custom' }] },
  });
  await service.save('antigravity', { revision: saved.revision, changes: { modelProvider: '' } });
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).not.toHaveProperty('modelProvider');
});

it('外部修改、损坏文件和非法地址均不会被覆盖', async () => {
  const { service, write } = await fixture();
  const file = await write('.claude/settings.json', '{}');
  const initial = await service.read('claude');
  await expect(
    service.save('claude', { revision: initial.revision, changes: { baseUrl: 'https://name:password@example.test' } }),
  ).rejects.toThrow('服务地址');
  await fs.writeFile(file, '{"external":true}');
  await expect(service.save('claude', { revision: initial.revision, changes: { model: 'new' } })).rejects.toMatchObject(
    { code: 'revision_conflict' },
  );
  expect(await fs.readFile(file, 'utf8')).toBe('{"external":true}');
  await fs.writeFile(file, 'invalid sentinel-secret');
  await expect(service.read('claude')).rejects.toMatchObject({ code: 'invalid_json' });
});

it('首次保存创建真实配置，空白环境认证名不能保存，返回原生 provider 不删除其他 provider', async () => {
  const { service } = await fixture();
  const initial = await service.read('codex');
  expect(initial.revision).toBe('missing');
  await expect(
    service.save('codex', { revision: initial.revision, changes: { provider: 'agentdeck', authMode: 'env' } }),
  ).rejects.toThrow('变量名');
  const saved = await service.save('codex', {
    revision: initial.revision,
    changes: { provider: 'agentdeck', baseUrl: 'https://example.test/v1', authMode: 'env', envKey: 'MY_MODEL_KEY' },
  });
  const restored = await service.save('codex', { revision: saved.revision, changes: { provider: 'openai' } });
  expect(restored.fields.find((field) => field.key === 'provider')?.value).toBe('openai');
  expect(
    restored.providers?.find((entry) => entry.id === 'agentdeck')?.fields.find((field) => field.key === 'envKey')
      ?.value,
  ).toBe('MY_MODEL_KEY');
});
