import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { parse } from 'smol-toml';
import { createModelSettingsService } from '../../src/settings/model-settings';
import { createNativeResourcesService } from '../../src/settings/native-resources';
import { createLaunchEnvironment } from '../../src/settings/launch-environment';

const roots: string[] = [];
async function fixture() {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'model-settings-'));
  roots.push(homeDir);
  const environment = createLaunchEnvironment({
    configDir: path.join(homeDir, 'workbench'),
    env: {},
    protector: {
      available: true,
      protect: async (value) => Buffer.from(value.toString('hex')),
      unprotect: async (value) => Buffer.from(value.toString(), 'hex'),
    },
  });
  const resources = createNativeResourcesService({ homeDir, env: {} });
  const service = createModelSettingsService({ resources, environment });
  const write = async (relative: string, content: string) => {
    const file = path.join(homeDir, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    return file;
  };
  return { service, write, environment, resources };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('Antigravity 原生保存冲突后恢复连接旧模式和值，不覆盖发生冲突的原生文件', async () => {
  const { service, write, environment, resources } = await fixture();
  const file = await write('.gemini/antigravity-cli/settings.json', '{"model":"old"}');
  await environment.save('antigravity', {
    revision: 'missing',
    variables: [
      { name: 'GEMINI_API_KEY', mode: 'set', value: 'prior-private-key' },
      { name: 'GOOGLE_GEMINI_BASE_URL', mode: 'disabled' },
    ],
  });
  const initial = await service.read('antigravity');
  expect(JSON.stringify(initial)).not.toContain('prior-private-key');
  const save = resources.save;
  vi.spyOn(resources, 'save').mockImplementationOnce(async (...args) => {
    await fs.writeFile(file, '{"model":"external"}');
    return save(...args);
  });
  await expect(
    service.save('antigravity', {
      revision: initial.revision,
      changes: { model: 'new', baseUrl: 'https://example.test/v1beta', apiKey: 'new-private-key' },
    }),
  ).rejects.toMatchObject({ code: 'revision_conflict' });
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ model: 'external' });
  expect(await environment.resolve('antigravity')).toMatchObject({ GEMINI_API_KEY: 'prior-private-key' });
  expect((await environment.read('antigravity')).variables).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'GEMINI_API_KEY', mode: 'set' }),
      expect.objectContaining({ name: 'GOOGLE_GEMINI_BASE_URL', mode: 'disabled' }),
    ]),
  );
  expect(JSON.stringify(await service.read('antigravity'))).not.toContain('private-key');
});

it('Antigravity 空白 Key 保留原值，单独填写 Key 不切换用户选择的连接方式', async () => {
  const { service, write, environment } = await fixture();
  const file = await write('.gemini/antigravity-cli/settings.json', '{}');
  const first = await service.read('antigravity');
  const saved = await service.save('antigravity', { revision: first.revision, changes: { apiKey: 'fixture-key' } });
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({});
  await service.save('antigravity', { revision: saved.revision, changes: { apiKey: '   ' } });
  expect((await environment.resolve('antigravity')).GEMINI_API_KEY).toBe('fixture-key');
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

it('Antigravity 同一表单保存原生自定义模型与加密连接，保留其他模型', async () => {
  const { service, write, environment } = await fixture();
  const file = await write(
    '.gemini/antigravity-cli/settings.json',
    '{"customModelsConfig":{"customModels":{"existing":{"modelName":"gemini-api://example.test/models/other","label":"Other"}}}}',
  );
  const initial = await service.read('antigravity');
  const saved = await service.save('antigravity', {
    revision: initial.revision,
    changes: {
      model: 'custom-id',
      displayName: 'Custom',
      modelProvider: 'gemini',
      baseUrl: 'https://example.test/v1beta',
      apiKey: 'fixture-key',
      contextWindow: '131072',
    },
  });
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toMatchObject({
    model: 'Custom',
    modelProvider: 'gemini',
    customModelsConfig: {
      customModels: { existing: { label: 'Other' }, agentdeck: { label: 'Custom', maxTokens: 131072 } },
    },
  });
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  expect(config.customModelsConfig.customModels.agentdeck.modelName).toBe(
    'gemini-api://example.test/v1beta/models/custom-id',
  );
  expect(JSON.stringify(config)).not.toContain('fixture-key');
  expect(JSON.stringify(saved)).not.toContain('fixture-key');
  expect(await environment.resolve('antigravity')).toMatchObject({
    GEMINI_API_KEY: 'fixture-key',
    GOOGLE_GEMINI_BASE_URL: 'https://example.test/v1beta',
  });
  await service.save('antigravity', { revision: saved.revision, changes: { modelProvider: '' } });
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).not.toHaveProperty('modelProvider');
});

it('模型显示名称与默认推理参数按原生字段保存，Codex窗口保持整数', async () => {
  const { service, write } = await fixture();
  const claude = await write(
    '.claude/settings.json',
    '{"model":"custom","modelPicker":{"options":[{"model":"other","label":"Other"}]}}',
  );
  const first = await service.read('claude');
  await service.save('claude', {
    revision: first.revision,
    changes: { displayName: 'Custom', reasoningEffort: 'high' },
  });
  expect(JSON.parse(await fs.readFile(claude, 'utf8'))).toMatchObject({
    effortLevel: 'high',
    modelPicker: {
      options: [
        { model: 'other', label: 'Other' },
        { model: 'custom', label: 'Custom' },
      ],
    },
  });
  const codex = await write(
    '.codex/config.toml',
    '# native\nmodel_provider="custom"\n[model_providers.custom]\nname="Old"\n',
  );
  const second = await service.read('codex');
  await service.save('codex', {
    revision: second.revision,
    changes: { displayName: 'New', reasoningEffort: 'ultra', contextWindow: '123456' },
  });
  expect(parse(await fs.readFile(codex, 'utf8'))).toMatchObject({
    model_reasoning_effort: 'ultra',
    model_context_window: 123456,
    model_providers: { custom: { name: 'New' } },
  });
  expect(await fs.readFile(codex, 'utf8')).toContain('# native');
});

it('选择已有 Antigravity 自定义键并改显示名时保留真实型号，清空模型不把名称当型号', async () => {
  const { service, write } = await fixture();
  const file = await write(
    '.gemini/antigravity-cli/settings.json',
    JSON.stringify({
      modelProvider: 'gemini',
      model: 'Built-in',
      customModelsConfig: {
        customModels: { saved: { modelName: 'gemini-api://example.test/models/real-id', label: 'Custom' } },
      },
    }),
  );
  const initial = await service.read('antigravity');
  const saved = await service.save('antigravity', {
    revision: initial.revision,
    changes: { model: 'saved', displayName: 'Renamed' },
  });
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toMatchObject({
    model: 'Renamed',
    customModelsConfig: {
      customModels: { saved: { modelName: 'gemini-api://example.test/models/real-id', label: 'Renamed' } },
    },
  });
  await expect(
    service.save('antigravity', { revision: saved.revision, changes: { model: '', contextWindow: '123456' } }),
  ).rejects.toThrow('先选择模型');
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
