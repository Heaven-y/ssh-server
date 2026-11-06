import { homedir } from 'node:os';
import path from 'node:path';
import type { AgentModel } from '@agentdeck/shared';
import { readConfigFile } from '../../settings/safe-file';
import { antigravityModelId, selectedAntigravityModel } from '../../settings/model-settings-fields';

type CustomModel = { modelName: string; label?: string; maxTokens?: number };
export type AntigravityModelSettings = {
  model?: string;
  modelProvider?: string;
  customModelsConfig?: { customModels: Record<string, CustomModel> };
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function customModels(value: unknown): Record<string, CustomModel> {
  const result: Record<string, CustomModel> = {};
  for (const [key, raw] of Object.entries(object(value))) {
    const item = object(raw);
    if (!text(item.modelName)) continue;
    const model: CustomModel = { modelName: text(item.modelName) };
    if (text(item.label)) model.label = text(item.label);
    if (typeof item.maxTokens === 'number' && Number.isSafeInteger(item.maxTokens) && item.maxTokens > 0)
      model.maxTokens = item.maxTokens;
    result[key] = model;
  }
  return result;
}

/** 仅读取模型白名单；复制到隔离发现目录时不带入 MCP、插件、Hooks 或认证。 */
export async function readAntigravityModelSettings(
  options: { homeDir?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<AntigravityModelSettings> {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? (process.platform === 'win32' ? env.USERPROFILE : env.HOME) ?? homedir();
  const { content } = await readConfigFile(path.join(home, '.gemini', 'antigravity-cli', 'settings.json'));
  if (!content.trim()) return {};
  const config = object(JSON.parse(content.replace(/^\uFEFF/, '')));
  return {
    model: text(config.model) || undefined,
    modelProvider: text(config.modelProvider) || undefined,
    customModelsConfig: { customModels: customModels(object(config.customModelsConfig).customModels) },
  };
}

/** headless 1.5.1 未应用自定义默认型号，显式补原生键避免回退或空模型。 */
export async function antigravityDefaultModel(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const settings = await readAntigravityModelSettings({ env });
  if (settings.modelProvider !== 'gemini') return undefined;
  const selected = selectedAntigravityModel(settings);
  return selected && text(selected.modelName) ? text(selected.key) : undefined;
}

/** 原生自定义条目的键和 label 均可用于 --model；模型名与窗口不从标题猜测。 */
export function configuredAntigravityModels(settings: AntigravityModelSettings): AgentModel[] {
  const result = new Map<string, AgentModel>();
  const entries = Object.entries(settings.customModelsConfig?.customModels ?? {});
  if (settings.modelProvider === 'gemini') {
    for (const [key, model] of entries) {
      const label = model.label || key;
      result.set(label, { id: key, label, description: '原生自定义模型' });
    }
  }
  const selectedCustom =
    settings.modelProvider === 'gemini' &&
    entries.some(([key, model]) => [key, model.label, antigravityModelId(model.modelName)].includes(settings.model));
  if (settings.model && !selectedCustom)
    result.set(settings.model, { id: settings.model, label: settings.model, description: '原生默认模型' });
  return [...result.values()];
}

/** 本机 agy models 返回已验证的两列 TSV；格式改变时不把说明文字当作模型。 */
export function parseAntigravityModelList(output: string): AgentModel[] {
  const result = new Map<string, AgentModel>();
  for (const line of output.split(/\r?\n/).filter((entry) => entry.trim())) {
    const columns = line.split('\t');
    if (
      columns.length !== 2 ||
      !columns.every(
        (column) =>
          column.trim() && [...column].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
      )
    )
      throw new Error('Antigravity 模型列表格式发生变化。');
    const id = columns[0]!.trim();
    result.set(id, { id, label: columns[1]!.trim() });
  }
  return [...result.values()];
}
