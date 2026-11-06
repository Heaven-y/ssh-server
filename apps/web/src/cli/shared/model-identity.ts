import type { AgentModel } from '@agentdeck/shared/conversation';
export const stripContext = (id: string) => id.replace(/\[1m\]$/i, '');
export const extendedContext = (id: string) => /\[1m\]$/i.test(id);

/** 只用于匹配元数据；调用 CLI 时始终使用用户选择的原始 id。 */
export function findModel(models: AgentModel[], id: string): AgentModel | undefined {
  const exact = models.find((model) => model.id === id);
  if (exact) return exact;
  const resolved = models.filter((model) => model.modelId === id);
  if (resolved.length === 1) return resolved[0];
  const base = models.filter((model) => stripContext(model.id) === stripContext(id));
  if (base.length === 1) return base[0];
  const underlying = models.filter((model) => stripContext(model.modelId ?? model.id) === stripContext(id));
  return underlying.length === 1 ? underlying[0] : undefined;
}

export function displayId(id: string, candidate?: AgentModel): string {
  let resolved = candidate?.modelId || id;
  if (candidate && id !== candidate.id && !extendedContext(id)) resolved = stripContext(resolved);
  if (extendedContext(id) && !extendedContext(resolved)) resolved += '[1m]';
  return resolved;
}

export function modelDisplay(id: string, candidate?: AgentModel): string {
  return id ? displayId(id, candidate) : '';
}
