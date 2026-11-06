import type { ModelSettingField } from '@agentdeck/shared/settings';
import type { ModelSettingsDraft } from '../shared/settings-types';
const connectionFields = ['baseUrl', 'apiKey', 'displayName', 'contextWindow'];
export function antigravitySettingsFields(fields: ModelSettingField[], draft: ModelSettingsDraft) {
  const connection = draft.modelProvider ?? fields.find((field) => field.key === 'modelProvider')?.value;
  return connection === 'gemini' ? fields : fields.filter((field) => !connectionFields.includes(field.key));
}
export function clearAntigravityConnection(draft: ModelSettingsDraft, field: string) {
  if (field === 'modelProvider') for (const key of connectionFields) delete draft[key];
}
