import type { ModelSettingField } from '@agentdeck/shared/settings';
import { field, string, type ConfigObject } from '../../common/configuration/fields';
import { antigravityModelId, selectedAntigravityModel } from './identity';
export function antigravityFields(config: ConfigObject): ModelSettingField[] {
  const provider = string(config.modelProvider);
  const custom = selectedAntigravityModel(config);
  return [
    field('displayName', '模型名称', custom?.label, { group: 'model', placeholder: '与模型 ID 相同' }),
    field('model', '默认模型', custom ? antigravityModelId(custom.modelName) : config.model, {
      group: 'model',
      hint: '选择原生模型或填写服务商的模型 ID；留空使用原生默认。',
    }),
    field('reasoningEffort', '推理强度', '随模型选择', {
      group: 'model',
      readOnly: true,
      hint: '选择原生模型列表中的不同强度版本。',
    }),
    field('contextWindow', '上下文窗口', custom?.maxTokens, {
      group: 'model',
      placeholder: '由模型决定，如 128K / 1M',
      hint: 'K = 1,000，M = 1,000,000 tokens；保存为原生整数。',
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
