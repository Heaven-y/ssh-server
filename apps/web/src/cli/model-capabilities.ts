import type { AgentKind, AgentModel } from '@agentdeck/shared/conversation';
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
