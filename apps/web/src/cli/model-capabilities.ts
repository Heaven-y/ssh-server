import type { AgentCapabilities, AgentKind, AgentModel } from '@agentdeck/shared/conversation';
import { findModel } from './shared/model-identity';
import { standardEfforts } from './shared/documented-models';
import { claudeEfforts } from './claude/model-policy';
import { codexEfforts } from './codex/model-policy';
import { antigravityEfforts, variant } from './antigravity/model-policy';
const effortPolicies = { claude: claudeEfforts, codex: codexEfforts };
export function modelEfforts(agent: AgentKind, id: string, models: AgentModel[]): string[] {
  const selected = findModel(models, id);
  const reported = selected?.reasoningEfforts;
  // [] 是明确不支持；undefined 才允许使用文档或原生变体补全。
  if (reported !== undefined)
    return [...new Set(reported)].filter((level) => agent === 'codex' || standardEfforts.includes(level));
  if (agent === 'antigravity') return antigravityEfforts(id, models);
  return effortPolicies[agent](selected?.modelId ?? id);
}

export function modelDefaultEffort(agent: AgentKind, id: string, models: AgentModel[]): string | undefined {
  const selected = findModel(models, id);
  if (selected?.defaultReasoningEffort) return selected.defaultReasoningEffort;
  if (agent === 'antigravity' && !selected?.modelId) return variant(id)?.[2];
  return undefined;
}

function sameConfiguredModel(id: string, configured: string | undefined, models: AgentModel[]): boolean {
  if (!configured) return false;
  if (id === configured) return true;
  const selected = findModel(models, id);
  return !!selected && selected === findModel(models, configured);
}

/** 目录默认只用于对应型号；切到另一型号后不猜配置档位是否仍然适用。 */
export function configuredModelEffort(agent: AgentKind, id: string, catalog?: AgentCapabilities): string | undefined {
  const models = catalog?.models ?? [];
  if (sameConfiguredModel(id, catalog?.defaultModel, models))
    return catalog?.defaultReasoningEffort ?? modelDefaultEffort(agent, id, models);
  if (catalog?.defaultReasoningEffort) return undefined;
  return modelDefaultEffort(agent, id, models);
}
