import type { AgentModel } from '@agentdeck/shared/conversation';
import type { NativeCapabilityCatalog } from '../capability-types';
import {
  configuredAntigravityDefault,
  configuredAntigravityModels,
  readAntigravityModelSettings,
} from './model-catalog';
import { discoverGeminiModels } from './model-discovery';

function mergeModels(discovered: AgentModel[], configured: AgentModel[]): AgentModel[] {
  const models = new Map<string, AgentModel>();
  for (const model of discovered) {
    const matches = configured.filter((entry) => entry.modelId && (entry.id === model.id || entry.label === model.id));
    const merged = matches.length === 1 ? { ...model, ...matches[0] } : model;
    models.set(merged.id, merged);
  }
  for (const model of configured) {
    if (!model.modelId && discovered.some((entry) => entry.label === model.id)) continue;
    models.set(model.id, model);
  }
  return [...models.values()];
}

function defaultSelection(models: AgentModel[], configured?: string) {
  if (models.some((model) => model.id === configured)) return configured;
  const matching = models.filter((model) => model.label === configured);
  return matching.length === 1 ? matching[0]!.id : configured;
}

/** 模型发现不启动真实工作区的 MCP；账号目录缺口不表示无法使用 API Key 对话。 */
export async function discoverAntigravityCapabilities(
  _dir: string,
  options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv; homeDir?: string } = {},
): Promise<NativeCapabilityCatalog> {
  options.signal?.throwIfAborted();
  const settings = await readAntigravityModelSettings(options);
  const env = options.env ?? process.env;
  const configured = configuredAntigravityModels(settings);
  const catalog: NativeCapabilityCatalog = {
    entries: [],
    models: configured,
    defaultModel: configuredAntigravityDefault(settings),
    warnings: [],
    modelWarning: '',
    commandWarnings: [],
  };
  if (settings.modelProvider !== 'gemini') return catalog;
  if (!env.GEMINI_API_KEY?.trim()) return { ...catalog, modelWarning: '请在模型设置中填写 API Key。' };
  try {
    const models = mergeModels(await discoverGeminiModels(settings, env, options.signal), configured);
    return {
      ...catalog,
      models,
      defaultModel: defaultSelection(models, catalog.defaultModel),
    };
  } catch {
    options.signal?.throwIfAborted();
    return { ...catalog, modelWarning: '暂时无法读取模型，已保留配置中的模型。' };
  }
}
