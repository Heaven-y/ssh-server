import { createHash } from 'node:crypto';
import type { NativeModelSettingsInput } from '@agentdeck/shared';
import {
  antigravityModelId,
  object,
  selectedAntigravityModel,
  string,
  type ConfigObject,
} from './model-settings-fields';

type Changes = NativeModelSettingsInput['changes'];
const owns = (changes: Changes, key: string) => Object.hasOwn(changes, key);

export function modelContextWindow(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1)
    throw new Error('上下文窗口必须是正整数（tokens）。');
  return number;
}

export function patchClaudeDisplayName(config: ConfigObject, changes: Changes): void {
  if (!owns(changes, 'displayName')) return;
  const model = string(config.model);
  if (!model) throw new Error('请先选择模型，再填写模型名称。');
  const picker = object(config.modelPicker);
  if (picker.options !== undefined && !Array.isArray(picker.options)) throw new Error('原生模型列表格式不可编辑。');
  const options = (picker.options as unknown[] | undefined)?.map(object) ?? [];
  const existing = options.find((entry) => entry.model === model);
  const label = changes.displayName?.trim() || model;
  if (existing) existing.label = label;
  else options.push({ model, label });
  config.modelPicker = { ...picker, options };
}

function antigravitySelection(config: ConfigObject, changes: Changes, previous?: ConfigObject) {
  const rawModel = selectedModelId(changes, previous);
  const model = rawModel || string(config.model);
  if (!model) throw new Error('请填写模型 ID。');
  const label = modelLabel(changes, previous) || model;
  return { model, label };
}
function selectedModelId(changes: Changes, previous?: ConfigObject) {
  const raw = antigravityModelId(previous?.modelName);
  if (!owns(changes, 'model')) return raw;
  const model = changes.model?.trim();
  if (!model) throw new Error('请先选择模型，再修改名称或上下文窗口。');
  return previous && [previous.key, previous.label, previous.modelName].includes(model) ? raw : model;
}
function modelLabel(changes: Changes, previous?: ConfigObject) {
  return owns(changes, 'displayName') ? changes.displayName?.trim() : string(previous?.label);
}
function shouldEditAntigravity(changes: Changes, previous?: ConfigObject) {
  return (
    ['displayName', 'contextWindow'].some((key) => owns(changes, key)) ||
    (!!previous && (owns(changes, 'baseUrl') || owns(changes, 'model') || owns(changes, 'modelProvider')))
  );
}
function applyWindow(entry: ConfigObject, changes: Changes) {
  if (!owns(changes, 'contextWindow')) return;
  const window = modelContextWindow(changes.contextWindow);
  if (window === null) delete entry.maxTokens;
  else entry.maxTokens = window;
}
/** URL 只放启动环境；model 按原生约定保存 label，条目稳定键供显式 --model 选择。 */
export function patchAntigravityModel(config: ConfigObject, changes: Changes): boolean {
  const previous = selectedAntigravityModel({ ...config, model: changes.model ?? config.model });
  if (config.modelProvider !== 'gemini' && !['displayName', 'contextWindow'].some((key) => owns(changes, key)))
    return false;
  if (!shouldEditAntigravity(changes, previous)) return false;
  if (config.modelProvider !== 'gemini') throw new Error('自定义模型需要选择 Gemini API Key 连接方式。');
  const customConfig = object(config.customModelsConfig);
  if (Array.isArray(customConfig.customModels)) throw new Error('原生自定义模型应为对象，请先在原始配置中修正。');
  const models = object(customConfig.customModels);
  const { model, label } = antigravitySelection(config, changes, previous);
  const key =
    string(previous?.key) ||
    (models.agentdeck ? `agentdeck-${createHash('sha256').update(model).digest('hex').slice(0, 12)}` : 'agentdeck');
  const entry: ConfigObject = {
    ...object(models[key]),
    modelName: antigravityModelId(model),
    label,
  };
  applyWindow(entry, changes);
  models[key] = entry;
  config.customModelsConfig = { ...customConfig, customModels: models };
  config.model = label;
  return true;
}

export function legacyAntigravityBaseUrl(config: ConfigObject): string | undefined {
  const previous = selectedAntigravityModel(config);
  const modelName = string(previous?.modelName);
  if (!modelName.startsWith('gemini-api://')) return undefined;
  const body = modelName.slice('gemini-api://'.length);
  const index = body.indexOf('/models/');
  if (index <= 0) return undefined;
  const host = body.slice(0, index);
  return /^https?:\/\//.test(host) ? host : `https://${host}`;
}
