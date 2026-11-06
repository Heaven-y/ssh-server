import type { AgentModel } from '@agentdeck/shared/conversation';
import { findModel } from '../../cli/shared/model-identity';

/** 当前覆盖不在目录里时仍可选择；别名和 [1m] 的匹配继续交给原有身份规则。 */
export function modelCandidates(models: AgentModel[], current: string): AgentModel[] {
  const selected = findModel(models, current) ?? (current ? { id: current, label: current } : undefined);
  const unique = new Map(models.map((model) => [model.id, model]));
  if (!selected) return [...unique.values()];
  unique.delete(selected.id);
  return [selected, ...unique.values()];
}

export function matchingModels(models: AgentModel[], phrase: string): AgentModel[] {
  const query = phrase.trim().toLocaleLowerCase();
  return query
    ? models.filter((model) => `${model.label} ${model.id} ${model.modelId ?? ''}`.toLocaleLowerCase().includes(query))
    : models;
}
