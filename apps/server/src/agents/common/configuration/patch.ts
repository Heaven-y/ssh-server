import type { NativeModelSettingsInput } from '@agentdeck/shared/settings';
import { has, object, type ConfigObject } from './fields';
export class ModelSettingsError extends Error {
  readonly code = 'model_settings_invalid';
  readonly status = 400;
}
export type Changes = NativeModelSettingsInput['changes'];
export type Edit = { path: string[]; value: string | number | boolean | null };
export const owns = (changes: Changes, key: string) => Object.hasOwn(changes, key);
export const normalized = (value: string | null | undefined) => value?.trim() || null;

export function validateUrl(value: string | null | undefined) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
  } catch {
    throw new ModelSettingsError('服务地址必须是有效的 HTTP(S) 地址，不能包含用户名、密码或片段。');
  }
}
export function validateKeys(changes: Changes, allowed: string[]) {
  if (Object.keys(changes).some((key) => !allowed.includes(key)))
    throw new ModelSettingsError('此 CLI 不支持所提交的配置字段。');
  validateUrl(changes.baseUrl);
}
export function setJson(config: ConfigObject, parts: string[], value: string | null) {
  let target = config;
  for (const part of parts.slice(0, -1)) {
    if (has(target, part) && (target[part] === null || typeof target[part] !== 'object' || Array.isArray(target[part])))
      throw new ModelSettingsError('已有配置结构不能通过表单编辑，请打开原始配置。');
    if (!has(target, part)) {
      if (value === null) return;
      target[part] = {};
    }
    target = object(target[part]);
  }
  if (value === null) delete target[parts.at(-1)!];
  else target[parts.at(-1)!] = value;
}
export function preserveSecret(key: string, value: string | null) {
  return ['apiKey', 'authToken'].includes(key) && value !== null && !value.trim();
}
export function encodeJson(content: string, config: ConfigObject) {
  const indent = /\n([\t ]+)"/.exec(content)?.[1] ?? '  ';
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  return (
    (content.startsWith('\uFEFF') ? '\uFEFF' : '') +
    JSON.stringify(config, null, indent).replace(/\n/g, newline) +
    newline
  );
}
export function applyJsonChanges(config: ConfigObject, changes: Changes, paths: Record<string, string[]>) {
  for (const [key, value] of Object.entries(changes)) {
    // 密钥的空输入表示保留；只有 null 明确删除，避免占位符或空表单擦除认证。
    if (preserveSecret(key, value) || !Object.hasOwn(paths, key)) continue;
    setJson(config, paths[key]!, normalized(value));
  }
}
