import type { ConfigObject } from '../../common/configuration/fields';
import {
  applyJsonChanges,
  encodeJson,
  ModelSettingsError,
  validateKeys,
  type Changes,
} from '../../common/configuration/patch';
import { patchAntigravityModel } from './custom-model';
const paths = { model: ['model'], modelProvider: ['modelProvider'] };
export function patch(content: string, config: ConfigObject, changes: Changes): string {
  validateKeys(changes, [...Object.keys(paths), 'displayName', 'baseUrl', 'contextWindow']);
  const provider = changes.modelProvider;
  if (provider && provider !== 'gemini' && provider !== config.modelProvider)
    throw new ModelSettingsError('请选择原生账号登录或 Gemini API Key 模式。');
  const previous = JSON.stringify(config);
  const original = structuredClone(config);
  applyJsonChanges(config, changes, paths);
  try {
    const custom: ConfigObject = { ...original, modelProvider: config.modelProvider };
    if (patchAntigravityModel(custom, changes)) {
      config.customModelsConfig = custom.customModelsConfig;
      config.model = custom.model;
    }
  } catch (error) {
    throw new ModelSettingsError((error as Error).message);
  }
  return JSON.stringify(config) === previous ? content : encodeJson(content, config);
}
