import type { ModelSettingField, NativeModelSettingsDocument } from '@agentdeck/shared/settings';
import { field, has, object, secret, string, type ConfigObject } from '../../common/configuration/fields';
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
      field('reasoningEffort', '推理强度', config.model_reasoning_effort, { group: 'model', placeholder: '原生默认' }),
      field('contextWindow', '上下文窗口', config.model_context_window, {
        group: 'model',
        placeholder: '由模型决定，如 128K / 1M',
        hint: 'K = 1,000，M = 1,000,000 tokens；保存为原生整数。',
      }),
      field('autoCompactTokenLimit', '自动压缩阈值', config.model_auto_compact_token_limit, {
        group: 'model',
        placeholder: '原生默认，如 128K',
        hint: '达到此 token 数时自动压缩历史；留空沿用 Codex 默认。计数口径和实际触发由原生配置决定。',
      }),
      field('provider', '服务商', selected, { options: providers.map(({ id, label }) => ({ value: id, label })) }),
    ],
    providers,
  };
}
