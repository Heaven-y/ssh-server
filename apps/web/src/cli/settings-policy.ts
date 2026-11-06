import type { AgentKind } from '@agentdeck/shared/conversation';
import type { ModelSettingField } from '@agentdeck/shared/settings';
import type { ModelSettingsDraft } from './shared/settings-types';
import { antigravitySettingsFields, clearAntigravityConnection } from './antigravity/settings-policy';
import { clearCodexConnection } from './codex/settings-policy';
export function cliSettingsFields(agent: AgentKind, fields: ModelSettingField[], draft: ModelSettingsDraft) {
  return agent === 'antigravity' ? antigravitySettingsFields(fields, draft) : fields;
}
const clearConnection = { codex: clearCodexConnection, antigravity: clearAntigravityConnection };
export function clearCliConnectionDraft(agent: AgentKind, draft: ModelSettingsDraft, field: string) {
  if (agent !== 'claude') clearConnection[agent](draft, field);
}
