import type { ModelSettingField } from '@agentdeck/shared/settings';
import { parse as parseToml } from 'smol-toml';
import { NativeResourceError } from './errors';

export type ConfigObject = Record<string, unknown>;
export const object = (value: unknown): ConfigObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as ConfigObject) : {};
export const string = (value: unknown) => (typeof value === 'string' ? value : '');
export const has = (value: ConfigObject, key: string) => Object.hasOwn(value, key);

export function parseModelConfig(format: 'json' | 'toml', content: string): ConfigObject {
  try {
    if (!content.trim()) return {};
    const value: unknown =
      format === 'toml' ? parseToml(content.replace(/^\uFEFF/, '')) : JSON.parse(content.replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as ConfigObject;
  } catch {
    throw new NativeResourceError(format === 'toml' ? 'invalid_toml' : 'invalid_json');
  }
}
export function field(
  key: string,
  label: string,
  value: unknown,
  details: Partial<ModelSettingField> = {},
): ModelSettingField {
  return {
    key,
    label,
    value: typeof value === 'number' ? String(value) : string(value),
    group: 'connection',
    ...details,
  };
}
export const secret = (key: string, label: string, value: unknown) =>
  field(key, label, '', {
    secret: true,
    hasValue: !!string(value),
  });
