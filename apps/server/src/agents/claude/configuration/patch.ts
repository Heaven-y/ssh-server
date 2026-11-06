import type { ConfigObject } from '../../common/configuration/fields';
import {
  applyJsonChanges,
  encodeJson,
  ModelSettingsError,
  validateKeys,
  type Changes,
} from '../../common/configuration/patch';
import { patchClaudeDisplayName } from './display-name';
import { claudePaths } from './fields';
export function patch(content: string, config: ConfigObject, changes: Changes): string {
  validateKeys(changes, [...Object.keys(claudePaths), 'displayName']);
  if (changes.reasoningEffort && !['low', 'medium', 'high', 'xhigh'].includes(changes.reasoningEffort))
    throw new ModelSettingsError('Claude 的默认推理强度支持 low、medium、high 和 xhigh。');
  const previous = JSON.stringify(config);
  applyJsonChanges(config, changes, claudePaths);
  try {
    patchClaudeDisplayName(config, changes);
  } catch (error) {
    throw new ModelSettingsError((error as Error).message);
  }
  return JSON.stringify(config) === previous ? content : encodeJson(content, config);
}
