import type { NativeCapabilityCatalog } from '../capability-types';
import { configuredAntigravityModels, readAntigravityModelSettings } from './model-catalog';
import { discoverGeminiModels } from './model-discovery';

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
    warnings: [],
    modelWarning: '',
    commandWarnings: [],
  };
  if (settings.modelProvider !== 'gemini') return catalog;
  if (!env.GEMINI_API_KEY?.trim()) return { ...catalog, modelWarning: '请在模型设置中填写 API Key。' };
  try {
    const models = await discoverGeminiModels(settings, env, options.signal);
    const ids = new Set(models.flatMap((model) => [model.id, model.label]));
    return {
      ...catalog,
      models: [...models, ...configured.filter((model) => !ids.has(model.id) && !ids.has(model.label))],
    };
  } catch {
    options.signal?.throwIfAborted();
    return { ...catalog, modelWarning: '暂时无法读取模型，已保留配置中的模型。' };
  }
}
