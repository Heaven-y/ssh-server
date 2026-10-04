import { ProductSettingsSchema, type ProductSettings } from '@ssh-server/shared';

export type ProductSettingsDraft = {
  defaultAgent: ProductSettings['defaultAgent'];
  claudeModel: string;
  codexModel: string;
  maxFileMiB: string;
  extensions: string;
  syncInterval: string;
  resourceInterval: string;
  resourceTimeout: string;
};
export const settingsDraft = (settings: ProductSettings): ProductSettingsDraft => ({
  defaultAgent: settings.defaultAgent,
  claudeModel: settings.defaultModels.claude,
  codexModel: settings.defaultModels.codex,
  maxFileMiB: String(settings.syncDefaults.maxFileBytes / 1024 / 1024),
  extensions: settings.syncDefaults.excludedExtensions.join(', '),
  syncInterval: String(settings.syncIntervalSeconds),
  resourceInterval: String(settings.resources.intervalSeconds),
  resourceTimeout: String(settings.resources.timeoutSeconds),
});
export function parseSettingsDraft(draft: ProductSettingsDraft) {
  return ProductSettingsSchema.safeParse({
    defaultAgent: draft.defaultAgent,
    defaultModels: { claude: draft.claudeModel, codex: draft.codexModel },
    syncDefaults: {
      maxFileBytes: Math.round(Number(draft.maxFileMiB) * 1024 * 1024),
      excludedExtensions: draft.extensions.split(/[,\s]+/).filter(Boolean),
    },
    syncIntervalSeconds: Number(draft.syncInterval),
    resources: { intervalSeconds: Number(draft.resourceInterval), timeoutSeconds: Number(draft.resourceTimeout) },
  });
}
const fieldPaths: Record<string, keyof ProductSettingsDraft> = {
  defaultAgent: 'defaultAgent',
  'defaultModels.claude': 'claudeModel',
  'defaultModels.codex': 'codexModel',
  'syncDefaults.maxFileBytes': 'maxFileMiB',
  'syncDefaults.excludedExtensions': 'extensions',
  syncIntervalSeconds: 'syncInterval',
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
