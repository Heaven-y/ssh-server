import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { parse } from 'smol-toml';
import { modelContextWindow } from '../../src/agents/common/configuration/token-count';
import { createModelSettingsService } from '../../src/settings/model-settings';
import { createNativeResourcesService } from '../../src/settings/native-resources';
import { createLaunchEnvironment } from '../../src/settings/launch-environment';
import type { AgentModel } from '@agentdeck/shared/conversation';

const roots: string[] = [];
async function fixture(nativeModels: () => Promise<AgentModel[]> = async () => []) {
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
  const service = createModelSettingsService({ resources, environment, antigravityModels: nativeModels });
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
  expect(config.customModelsConfig.customModels.agentdeck.modelName).toBe('custom-id');
  expect(JSON.stringify(config)).not.toContain('fixture-key');
  expect(JSON.stringify(saved)).not.toContain('fixture-key');
  expect(await environment.resolve('antigravity')).toMatchObject({
    GEMINI_API_KEY: 'fixture-key',
    GOOGLE_GEMINI_BASE_URL: 'https://example.test',
  });
  await service.save('antigravity', { revision: saved.revision, changes: { modelProvider: '' } });
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).not.toHaveProperty('modelProvider');
});

it('Gemini 最简连接和未知模型切换自动登记模型，保留旧条目且默认选择原生 label', async () => {
  const { service, write, environment } = await fixture();
  const file = await write('.gemini/antigravity-cli/settings.json', '{}');
  const initial = await service.read('antigravity');
  const first = await service.save('antigravity', {
    revision: initial.revision,
    changes: {
      modelProvider: 'gemini',
      model: 'custom-one',
      baseUrl: 'https://example.test/v1beta',
      apiKey: 'fixture-key',
    },
  });
  let config = JSON.parse(await fs.readFile(file, 'utf8'));
  expect(config).toMatchObject({
    model: 'custom-one',
    customModelsConfig: {
      customModels: {
        agentdeck: { modelName: 'custom-one', label: 'custom-one' },
      },
    },
  });
  expect(config.customModelsConfig.customModels.agentdeck).not.toHaveProperty('maxTokens');
  await service.save('antigravity', { revision: first.revision, changes: { model: 'custom-two' } });
  config = JSON.parse(await fs.readFile(file, 'utf8'));
  expect(config.model).toBe('custom-two');
  expect(Object.values(config.customModelsConfig.customModels)).toEqual(
    expect.arrayContaining([
      { modelName: 'custom-one', label: 'custom-one' },
      { modelName: 'custom-two', label: 'custom-two' },
    ]),
  );
  expect((await environment.resolve('antigravity')).GOOGLE_GEMINI_BASE_URL).toBe('https://example.test');
});

it('原生模型 ID 保存为对应 label，保持 CLI 的强度变体而不登记成服务端型号', async () => {
  const catalog = vi.fn(async () => [{ id: 'gemini-example-high', label: 'Gemini Example (High)' }]);
  const { service, write } = await fixture(catalog);
  const file = await write('.gemini/antigravity-cli/settings.json', '{"modelProvider":"gemini"}');
  const initial = await service.read('antigravity');
  await service.save('antigravity', { revision: initial.revision, changes: { model: 'gemini-example-high' } });
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
    modelProvider: 'gemini',
    model: 'Gemini Example (High)',
  });
  expect(catalog).toHaveBeenCalledOnce();
});

it('原生目录读取失败保留用户输入，显式自定义连接仍可登记', async () => {
  const { service, write } = await fixture(async () => {
    throw new Error('unavailable');
  });
  const file = await write('.gemini/antigravity-cli/settings.json', '{"modelProvider":"gemini"}');
  const initial = await service.read('antigravity');
  const saved = await service.save('antigravity', {
    revision: initial.revision,
    changes: { model: 'native-selection' },
  });
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ modelProvider: 'gemini', model: 'native-selection' });
  await service.save('antigravity', {
    revision: saved.revision,
    changes: { model: 'custom-api-model', baseUrl: 'https://example.test' },
  });
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toMatchObject({
    model: 'custom-api-model',
    customModelsConfig: {
      customModels: {
        agentdeck: { modelName: 'custom-api-model' },
      },
    },
  });
});

it('模型参数按原生字段保存，Codex窗口与压缩阈值独立读写并可恢复默认', async () => {
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
  const saved = await service.save('codex', {
    revision: second.revision,
    changes: { displayName: 'New', reasoningEffort: 'ultra', contextWindow: '1.5m', autoCompactTokenLimit: '128K' },
  });
  expect(parse(await fs.readFile(codex, 'utf8'))).toMatchObject({
    model_reasoning_effort: 'ultra',
    model_context_window: 1500000,
    model_auto_compact_token_limit: 128000,
    model_providers: { custom: { name: 'New' } },
  });
  expect(await fs.readFile(codex, 'utf8')).toContain('# native');
  expect(saved.fields.find((field) => field.key === 'autoCompactTokenLimit')).toMatchObject({
    value: '128000',
    placeholder: '原生默认，如 128K',
  });
  await expect(
    service.save('codex', { revision: saved.revision, changes: { autoCompactTokenLimit: '1.5' } }),
  ).rejects.toThrow('自动压缩阈值必须是正整数');
  const restored = await service.save('codex', { revision: saved.revision, changes: { autoCompactTokenLimit: '' } });
  const content = parse(await fs.readFile(codex, 'utf8'));
  expect(content.model_context_window).toBe(1500000);
  expect(content).not.toHaveProperty('model_auto_compact_token_limit');
  expect(restored.fields.find((field) => field.key === 'autoCompactTokenLimit')?.value).toBe('');
});

it('选择旧 Antigravity 自定义键并改名时迁移地址，默认选择同步原生 label', async () => {
  const { service, write, environment } = await fixture();
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
      customModels: { saved: { modelName: 'real-id', label: 'Renamed' } },
    },
  });
  expect((await environment.resolve('antigravity')).GOOGLE_GEMINI_BASE_URL).toBe('https://example.test');
  expect(saved.fields.find((field) => field.key === 'model')?.value).toBe('real-id');
  await expect(
    service.save('antigravity', { revision: saved.revision, changes: { model: '', contextWindow: '123456' } }),
  ).rejects.toThrow('先选择模型');
});

it.each(['set', 'disabled'] as const)('旧 URI 标准化保留已有 %s 地址选择', async (mode) => {
  const { service, write, environment } = await fixture();
  const file = await write(
    '.gemini/antigravity-cli/settings.json',
    JSON.stringify({
      modelProvider: 'gemini',
      model: 'saved',
      customModelsConfig: {
        customModels: { saved: { modelName: 'gemini-api://old.example.test/models/real-id', label: 'Old' } },
      },
    }),
  );
  await environment.save('antigravity', {
    revision: 'missing',
    variables: [
      { name: 'GOOGLE_GEMINI_BASE_URL', mode, ...(mode === 'set' ? { value: 'https://current.example.test' } : {}) },
    ],
  });
  const initial = await service.read('antigravity');
  await service.save('antigravity', { revision: initial.revision, changes: { displayName: 'New' } });
  expect(JSON.parse(await fs.readFile(file, 'utf8')).customModelsConfig.customModels.saved.modelName).toBe('real-id');
  expect((await environment.resolve('antigravity')).GOOGLE_GEMINI_BASE_URL).toBe(
    mode === 'set' ? 'https://current.example.test' : undefined,
  );
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

it('token 简写使用十进制精确整数并拒绝溢出或分数 token', () => {
  expect(modelContextWindow(' 1.001 K ')).toBe(1001);
  expect(modelContextWindow('1M')).toBe(1000000);
  expect(modelContextWindow('128000')).toBe(128000);
  expect(modelContextWindow('')).toBeNull();
  for (const value of ['0', '-1K', '1e3', '1.0001K', '9007199254740992', '1G']) {
    expect(() => modelContextWindow(value)).toThrow('必须是正整数');
  }
});

it('Antigravity 无效服务地址返回字段错误，且不改原生文件和连接环境', async () => {
  const { service, write, environment } = await fixture();
  const content = '{"model":"custom","modelProvider":"gemini"}';
  const file = await write('.gemini/antigravity-cli/settings.json', content);
  const initial = await service.read('antigravity');
  const before = await environment.read('antigravity');
  await expect(
    service.save('antigravity', {
      revision: initial.revision,
      changes: { baseUrl: 'invalid-url', apiKey: 'fixture-key' },
    }),
  ).rejects.toMatchObject({ status: 400, code: 'model_settings_invalid' });
  expect(await fs.readFile(file, 'utf8')).toBe(content);
  expect(await environment.read('antigravity')).toEqual(before);
});
