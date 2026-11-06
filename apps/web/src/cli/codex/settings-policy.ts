import type { ModelSettingsDraft } from '../shared/settings-types';
export function clearCodexConnection(draft: ModelSettingsDraft, field: string) {
  if (field === 'authMode') for (const key of ['apiKey', 'envKey']) delete draft[key];
}
