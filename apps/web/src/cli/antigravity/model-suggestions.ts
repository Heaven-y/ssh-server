import type { AgentModel } from '@agentdeck/shared/conversation';

/** 仅合并有明确原生身份对应的同名别名；底层目录保留完整，强度变体与发送值不变。 */
function combinedValue(models: AgentModel[], current: string): string | undefined {
  if (models.length !== 2) return;
  const native = models.find((model) => !model.modelId);
  const alias = models.find((model) => !!model.modelId);
  if (!native || !alias || ![native.id, native.label].includes(alias.modelId!)) return;
  return [native.id, native.label, alias.id].includes(current) ? current : native.id;
}

export function antigravityModelSuggestions(models: AgentModel[], current: string) {
  const groups = new Map<string, AgentModel[]>();
  for (const model of models) {
    const entries = groups.get(model.label) ?? [];
    entries.push(model);
    groups.set(model.label, entries);
  }
  return [...groups].flatMap(([label, entries]) => {
    const value = combinedValue(entries, current);
    if (value) return [{ value, label }];
    return entries.map((model) => ({
      value: model.id,
      label: entries.length > 1 ? `${label}（${model.id}）` : label,
    }));
  });
}
