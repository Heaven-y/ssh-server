import { createHash } from 'node:crypto';
import type { NativeModelSettingsInput } from '@agentdeck/shared';
import { object, selectedAntigravityModel, string, type ConfigObject } from './model-settings-fields';

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
  const previousName = string(previous?.modelName);
  const rawModel = selectedModelId(changes, previous);
  const model = rawModel || string(config.model);
  if (!model) throw new Error('请填写模型 ID。');
  const label = modelLabel(changes, previous) || model;
  return { model, label, previousName };
}
function selectedModelId(changes: Changes, previous?: ConfigObject) {
  const raw = string(previous?.modelName).split('/models/').at(-1);
  if (!owns(changes, 'model')) return raw;
  const model = changes.model?.trim();
  if (!model) throw new Error('请先选择模型，再修改名称或上下文窗口。');
  return previous && [previous.key, previous.label, previous.modelName].includes(model) ? raw : model;
}
function modelLabel(changes: Changes, previous?: ConfigObject) {
  return owns(changes, 'displayName') ? changes.displayName?.trim() : string(previous?.label);
}
function antigravityAddress(model: string, previousName: string, baseUrl?: string) {
  const endpoint =
    baseUrl ||
    previousName.replace(/^gemini-api:\/\//, 'https://').split('/models/')[0] ||
    'https://generativelanguage.googleapis.com/v1beta';
  if (!endpoint || !/^https?:\/\//.test(endpoint)) throw new Error('请填写自定义模型的服务地址。');
  return `gemini-api://${endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '')}/models/${model}`;
}
function shouldEditAntigravity(changes: Changes, previous?: ConfigObject) {
  return (
    ['displayName', 'contextWindow'].some((key) => owns(changes, key)) ||
    (!!previous && owns(changes, 'baseUrl') && !owns(changes, 'model'))
  );
}
function applyWindow(entry: ConfigObject, changes: Changes) {
  if (!owns(changes, 'contextWindow')) return;
  const window = modelContextWindow(changes.contextWindow);
  if (window === null) delete entry.maxTokens;
  else entry.maxTokens = window;
}
/** Antigravity 用对象映射登记自定义模型，model 保存原生显示名称。 */
export function patchAntigravityModel(config: ConfigObject, changes: Changes): boolean {
  const previous = selectedAntigravityModel({ ...config, model: changes.model ?? config.model });
  if (!shouldEditAntigravity(changes, previous)) return false;
  if (config.modelProvider !== 'gemini') throw new Error('自定义模型需要选择 Gemini API Key 连接方式。');
  const customConfig = object(config.customModelsConfig);
  if (Array.isArray(customConfig.customModels)) throw new Error('原生自定义模型应为对象，请先在原始配置中修正。');
  const models = object(customConfig.customModels);
  const { model, label, previousName } = antigravitySelection(config, changes, previous);
  const key =
    string(previous?.key) ||
    (models.agentdeck ? `agentdeck-${createHash('sha256').update(model).digest('hex').slice(0, 12)}` : 'agentdeck');
  const entry: ConfigObject = {
    ...object(models[key]),
    modelName: antigravityAddress(model, previousName, changes.baseUrl ?? undefined),
    label,
  };
  applyWindow(entry, changes);
  models[key] = entry;
  config.customModelsConfig = { ...customConfig, customModels: models };
  config.model = label;
  return true;
}
