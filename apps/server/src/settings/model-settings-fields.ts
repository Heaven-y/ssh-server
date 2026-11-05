import { parse as parseToml } from 'smol-toml';
import type { AgentKind, ModelSettingField, NativeModelSettingsDocument } from '@agentdeck/shared';
import { NativeResourceError } from './native-resources-errors';

export type ConfigObject = Record<string, unknown>;
export const object = (value: unknown): ConfigObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as ConfigObject) : {};
export const string = (value: unknown) => (typeof value === 'string' ? value : '');
export const has = (value: ConfigObject, key: string) => Object.hasOwn(value, key);

export function parseModelConfig(agent: AgentKind, content: string): ConfigObject {
  try {
    if (!content.trim()) return {};
    const value: unknown =
      agent === 'codex' ? parseToml(content.replace(/^\uFEFF/, '')) : JSON.parse(content.replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as ConfigObject;
  } catch {
    throw new NativeResourceError(agent === 'codex' ? 'invalid_toml' : 'invalid_json');
  }
}
export function field(
  key: string,
  label: string,
  value: unknown,
  details: Partial<ModelSettingField> = {},
): ModelSettingField {
  return {
    key,
    label,
    value: typeof value === 'number' ? String(value) : string(value),
    group: 'connection',
    ...details,
  };
}
const secret = (key: string, label: string, value: unknown) =>
  field(key, label, '', {
    secret: true,
    hasValue: !!string(value),
  });

export const claudePaths: Record<string, string[]> = {
  model: ['model'],
  baseUrl: ['env', 'ANTHROPIC_BASE_URL'],
  apiKey: ['env', 'ANTHROPIC_API_KEY'],
  authToken: ['env', 'ANTHROPIC_AUTH_TOKEN'],
  sonnetModel: ['env', 'ANTHROPIC_DEFAULT_SONNET_MODEL'],
  opusModel: ['env', 'ANTHROPIC_DEFAULT_OPUS_MODEL'],
  haikuModel: ['env', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'],
  reasoningEffort: ['effortLevel'],
};
export function claudeFields(config: ConfigObject): ModelSettingField[] {
  const env = object(config.env);
  const picker = object(config.modelPicker).options;
  const selected = Array.isArray(picker) ? picker.map(object).find((entry) => entry.model === config.model) : undefined;
  return [
    field('displayName', '模型名称', selected?.label, { group: 'model', placeholder: '与模型 ID 相同' }),
    field('model', '默认模型', config.model, { group: 'model', hint: '沿用 CLI 的模型名或别名；留空使用原生默认。' }),
    field('reasoningEffort', '推理强度', config.effortLevel, {
      group: 'model',
      options: ['', 'low', 'medium', 'high', 'xhigh'].map((value) => ({ value, label: value || '自动' })),
    }),
    field('contextWindow', '上下文窗口', '由模型决定', { group: 'model', readOnly: true }),
    ...(['sonnet', 'opus', 'haiku'] as const).map((name) =>
      field(
        `${name}Model`,
        `${name[0]!.toUpperCase()}${name.slice(1)} 映射`,
        env[`ANTHROPIC_DEFAULT_${name.toUpperCase()}_MODEL`],
        { group: 'model', advanced: true },
      ),
    ),
    field('baseUrl', '服务地址', env.ANTHROPIC_BASE_URL, {
      hint: '写入原生 env.ANTHROPIC_BASE_URL；留空使用默认地址。',
    }),
    {
      ...secret('apiKey', 'API Key', env.ANTHROPIC_API_KEY),
      advanced: !!env.ANTHROPIC_AUTH_TOKEN && !env.ANTHROPIC_API_KEY,
    },
    {
      ...secret(
        'authToken',
        env.ANTHROPIC_AUTH_TOKEN && !env.ANTHROPIC_API_KEY ? 'API Key' : 'Auth Token',
        env.ANTHROPIC_AUTH_TOKEN,
      ),
      advanced: !env.ANTHROPIC_AUTH_TOKEN || !!env.ANTHROPIC_API_KEY,
    },
  ];
}

export function codexAuthMode(provider: ConfigObject) {
  const hasAuthorization = (headers: unknown) =>
    Object.keys(object(headers)).some((name) => name.toLowerCase() === 'authorization');
  if (
    ['auth', 'gateway_oauth', 'aws'].some((key) => has(provider, key)) ||
    hasAuthorization(provider.http_headers) ||
    hasAuthorization(provider.env_http_headers)
  )
    return 'command';
  if (string(provider.env_key)) return 'env';
  if (string(provider.experimental_bearer_token)) return 'token';
  return provider.requires_openai_auth === true ? 'native' : 'token';
}
export function nativeCodexProvider(config: ConfigObject, id: string) {
  return ['ollama', 'lmstudio'].includes(id) || (id !== 'agentdeck' && !has(object(config.model_providers), id));
}
function codexProviderFields(config: ConfigObject, id: string): ModelSettingField[] {
  if (id === 'openai')
    return [
      field('baseUrl', '服务地址', config.openai_base_url, {
        hint: '留空使用 OpenAI 原生地址。认证沿用 Codex 登录；API Key 可在启动环境中设置 OPENAI_API_KEY。',
      }),
    ];
  if (nativeCodexProvider(config, id)) return [];
  const provider = object(object(config.model_providers)[id]);
  const mode = codexAuthMode(provider);
  return [
    field('displayName', '服务名称', provider.name, { placeholder: '自定义服务' }),
    field('baseUrl', '服务地址', provider.base_url, { hint: '使用兼容 Responses API 的服务地址。' }),
    field('authMode', '认证方式', mode, {
      advanced: true,
      options:
        mode === 'command'
          ? [{ value: 'command', label: '沿用高级认证' }]
          : [
              { value: 'token', label: 'API Key' },
              { value: 'env', label: '环境变量' },
              { value: 'native', label: '沿用 OpenAI 登录' },
            ],
      hint:
        mode === 'command'
          ? '已有高级认证，使用原始配置编辑，避免覆盖。'
          : '直接填写 Key 使用原生 experimental_bearer_token；原生文件中为明文。',
    }),
    field('envKey', '密钥环境变量名', provider.env_key, {
      advanced: true,
      hint: '填写变量名，例如 OPENAI_API_KEY；变量值由启动 CLI 的环境提供。',
    }),
    secret('apiKey', 'API Key', provider.experimental_bearer_token),
  ];
}
export function codexFields(config: ConfigObject): Pick<NativeModelSettingsDocument, 'fields' | 'providers'> {
  const selected = string(config.model_provider) || 'openai';
  const entries = object(config.model_providers);
  const ids = [...new Set(['openai', ...Object.keys(entries), selected, 'agentdeck'])];
  const providers = ids.map((id) => ({
    id,
    label:
      id === 'openai'
        ? 'OpenAI · 原生登录'
        : string(object(entries[id]).name) || (id === 'agentdeck' ? '自定义服务' : id),
    fields: codexProviderFields(config, id),
  }));
  return {
    fields: [
      field('model', '默认模型', config.model, {
        group: 'model',
        hint: '填写 CLI 或服务商支持的模型名称；留空使用原生默认。',
      }),
      field('reasoningEffort', '推理强度', config.model_reasoning_effort, { group: 'model', placeholder: '自动' }),
      field('contextWindow', '上下文窗口', config.model_context_window, {
        group: 'model',
        inputType: 'number',
        placeholder: '由模型决定（tokens）',
      }),
      field('provider', '服务商', selected, { options: providers.map(({ id, label }) => ({ value: id, label })) }),
    ],
    providers,
  };
}
export function antigravityFields(config: ConfigObject): ModelSettingField[] {
  const provider = string(config.modelProvider);
  const custom = selectedAntigravityModel(config);
  return [
    field('displayName', '模型名称', custom?.label, { group: 'model', placeholder: '与模型 ID 相同' }),
    field('model', '默认模型', custom ? string(custom.modelName).split('/models/').at(-1) : config.model, {
      group: 'model',
      hint: '填写 agy /model 中的模型显示名称；留空使用原生默认。',
    }),
    field('reasoningEffort', '推理强度', '随模型选择', {
      group: 'model',
      readOnly: true,
      hint: '选择原生模型列表中的不同强度版本。',
    }),
    field('contextWindow', '上下文窗口', custom?.maxTokens, {
      group: 'model',
      inputType: 'number',
      placeholder: '由模型决定（tokens）',
    }),
    field('modelProvider', '连接方式', provider, {
      options: [
        { value: '', label: 'Antigravity 账号登录' },
        { value: 'gemini', label: 'Gemini API Key' },
        ...(provider && provider !== 'gemini' ? [{ value: provider, label: `${provider} · 已有原生值` }] : []),
      ],
      hint: '自定义地址使用 Gemini API 协议。',
    }),
  ];
}

export function selectedAntigravityModel(config: ConfigObject): ConfigObject | undefined {
  const models = object(object(config.customModelsConfig).customModels);
  const matches = Object.entries(models)
    .map(([key, value]): ConfigObject => ({ ...object(value), key }))
    .filter(
      (entry) =>
        entry.key === config.model ||
        entry.label === config.model ||
        entry.modelName === config.model ||
        string(entry.modelName).split('/models/').at(-1) === config.model,
    );
  return matches.length === 1 ? matches[0] : undefined;
}
