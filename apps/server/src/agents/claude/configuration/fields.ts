import type { ModelSettingField } from '@agentdeck/shared/settings';
import { field, object, secret, type ConfigObject } from '../../common/configuration/fields';
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
      options: ['', 'low', 'medium', 'high', 'xhigh'].map((value) => ({ value, label: value || '原生默认' })),
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
