import type { NativeModelSettingsInput } from '@agentdeck/shared/settings';
import { object, string, type ConfigObject } from '../../common/configuration/fields';
type Changes = NativeModelSettingsInput['changes'];
const owns = (changes: Changes, key: string) => Object.hasOwn(changes, key);
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
