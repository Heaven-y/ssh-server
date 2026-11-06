import type { AgentModel, NativeModelSettingsInput } from '@agentdeck/shared';
import { discoverGeminiModels } from '../agents/antigravity/model-discovery';
import { object, selectedAntigravityModel, string, type ConfigObject } from './model-settings-fields';

type Changes = NativeModelSettingsInput['changes'];
export type AntigravityModelCatalog = () => Promise<AgentModel[]>;

/** 复用隔离目录发现，仅取 CLI 内置 ID/label；不携带真实密钥或访问服务端点。 */
export const nativeAntigravityModels: AntigravityModelCatalog = () =>
  discoverGeminiModels(
    { modelProvider: 'gemini' },
    {
      ...process.env,
      GEMINI_API_KEY: 'local-model-catalog',
      AGY_ADC_AUTH: undefined,
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      GOOGLE_GEMINI_BASE_URL: 'http://127.0.0.1:9',
      HTTP_PROXY: 'http://127.0.0.1:9',
      HTTPS_PROXY: 'http://127.0.0.1:9',
      NO_PROXY: '127.0.0.1,localhost',
    },
  );

function requestedModel(config: ConfigObject, changes: Changes): string {
  if (Object.hasOwn(changes, 'model')) return changes.model?.trim() ?? '';
  return Object.hasOwn(changes, 'modelProvider') ? string(config.model) : '';
}

function explicitCustomConnection(config: ConfigObject, changes: Changes): boolean {
  return !!changes.baseUrl?.trim() || Object.keys(object(object(config.customModelsConfig).customModels)).length > 0;
}

async function availableModels(discover: AntigravityModelCatalog): Promise<AgentModel[] | undefined> {
  try {
    return await discover();
  } catch {
    return undefined;
  }
}

/** 原生默认保存 label；未知服务 ID 登记为自定义模型，防止 CLI 静默回退默认。 */
export async function antigravitySelectionChanges(
  config: ConfigObject,
  changes: Changes,
  discover: AntigravityModelCatalog,
): Promise<Changes> {
  if ((changes.modelProvider ?? config.modelProvider) !== 'gemini') return changes;
  const model = requestedModel(config, changes);
  if (!model || selectedAntigravityModel({ ...config, model })) return changes;
  const models = await availableModels(discover);
  const native = models?.find((entry) => entry.id === model || entry.label === model);
  if (native) return { ...changes, model: native.label };
  if (!models && !explicitCustomConnection(config, changes)) return changes;
  return { ...changes, model, displayName: changes.displayName ?? model };
}
