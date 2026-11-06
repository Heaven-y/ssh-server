import { has, object, string, type ConfigObject } from '../../common/configuration/fields';
/** 旧配置把地址拼进 modelName；展示与迁移时只提取真实模型 ID。 */
export function antigravityModelId(value: unknown): string {
  const raw = string(value).trim();
  if (!raw.startsWith('gemini-api://')) return raw;
  const model = raw.slice('gemini-api://'.length).split('/models/').at(-1) ?? '';
  return model.split(/[?#]/, 1)[0]!.trim();
}

export function selectedAntigravityModel(config: ConfigObject): ConfigObject | undefined {
  const models = object(object(config.customModelsConfig).customModels);
  const selectedKey = string(config.model);
  if (selectedKey && has(models, selectedKey)) return { ...object(models[selectedKey]), key: selectedKey };
  const matches = Object.entries(models)
    .map(([key, value]): ConfigObject => ({ ...object(value), key }))
    .filter(
      (entry) =>
        entry.key === config.model ||
        entry.label === config.model ||
        entry.modelName === config.model ||
        antigravityModelId(entry.modelName) === config.model,
    );
  return matches.length === 1 ? matches[0] : undefined;
}
