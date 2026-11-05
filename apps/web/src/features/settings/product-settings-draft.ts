import { ProductSettingsSchema, type ProductSettings } from '@agentdeck/shared';

export type ProductSettingsDraft = {
  defaultAgent: ProductSettings['defaultAgent'];
  resourceInterval: string;
  resourceTimeout: string;
};
export const settingsDraft = (settings: ProductSettings): ProductSettingsDraft => ({
  defaultAgent: settings.defaultAgent,
  resourceInterval: String(settings.resources.intervalSeconds),
  resourceTimeout: String(settings.resources.timeoutSeconds),
});
export function parseSettingsDraft(draft: ProductSettingsDraft) {
  return ProductSettingsSchema.safeParse({
    defaultAgent: draft.defaultAgent,
    resources: { intervalSeconds: Number(draft.resourceInterval), timeoutSeconds: Number(draft.resourceTimeout) },
  });
}
const fieldPaths: Record<string, keyof ProductSettingsDraft> = {
  defaultAgent: 'defaultAgent',
  'resources.intervalSeconds': 'resourceInterval',
  'resources.timeoutSeconds': 'resourceTimeout',
};
export function draftErrors(draft: ProductSettingsDraft): Partial<Record<keyof ProductSettingsDraft, string>> {
  const result = parseSettingsDraft(draft);
  if (result.success) return {};
  const errors: Partial<Record<keyof ProductSettingsDraft, string>> = {};
  for (const issue of result.error.issues) {
    const field = fieldPaths[issue.path.slice(0, 2).join('.')];
    if (field) errors[field] = '请按字段提示填写有效值。';
  }
  return errors;
}
