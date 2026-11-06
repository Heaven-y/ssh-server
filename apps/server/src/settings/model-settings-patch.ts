import type { AgentKind, NativeModelSettingsInput } from '@agentdeck/shared';
import { updateTomlFields } from './toml-fields';
import { modelContextWindow, patchAntigravityModel, patchClaudeDisplayName } from './model-settings-custom';
import {
  claudePaths,
  codexAuthMode,
  has,
  nativeCodexProvider,
  object,
  string,
  type ConfigObject,
} from './model-settings-fields';

export class ModelSettingsError extends Error {
  readonly code = 'model_settings_invalid';
  readonly status = 400;
}
type Changes = NativeModelSettingsInput['changes'];
type Edit = { path: string[]; value: string | number | boolean | null };
const owns = (changes: Changes, key: string) => Object.hasOwn(changes, key);
const normalized = (value: string | null | undefined) => value?.trim() || null;

function validateUrl(value: string | null | undefined) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
  } catch {
    throw new ModelSettingsError('服务地址必须是有效的 HTTP(S) 地址，不能包含用户名、密码或片段。');
  }
}
function validateKeys(changes: Changes, allowed: string[]) {
  if (Object.keys(changes).some((key) => !allowed.includes(key)))
    throw new ModelSettingsError('此 CLI 不支持所提交的配置字段。');
  validateUrl(changes.baseUrl);
}
function setJson(config: ConfigObject, parts: string[], value: string | null) {
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
function validateAgyProvider(config: ConfigObject, changes: Changes) {
  const provider = changes.modelProvider;
  if (provider && provider !== 'gemini' && provider !== config.modelProvider)
    throw new ModelSettingsError('请选择原生账号登录或 Gemini API Key 模式。');
}
function preserveSecret(key: string, value: string | null) {
  return ['apiKey', 'authToken'].includes(key) && value !== null && !value.trim();
}
function encodeJson(content: string, config: ConfigObject) {
  const indent = /\n([\t ]+)"/.exec(content)?.[1] ?? '  ';
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  return (
    (content.startsWith('\uFEFF') ? '\uFEFF' : '') +
    JSON.stringify(config, null, indent).replace(/\n/g, newline) +
    newline
  );
}
function validateJsonChanges(
  agent: AgentKind,
  changes: Changes,
  config: ConfigObject,
  paths: Record<string, string[]>,
) {
  const extras = agent === 'antigravity' ? ['displayName', 'baseUrl', 'contextWindow'] : ['displayName'];
  validateKeys(changes, [...Object.keys(paths), ...extras]);
  if (agent === 'antigravity') validateAgyProvider(config, changes);
  if (
    agent === 'claude' &&
    changes.reasoningEffort &&
    !['low', 'medium', 'high', 'xhigh'].includes(changes.reasoningEffort)
  )
    throw new ModelSettingsError('Claude 的默认推理强度支持 low、medium、high 和 xhigh。');
}
function applyJsonChanges(config: ConfigObject, changes: Changes, paths: Record<string, string[]>) {
  for (const [key, value] of Object.entries(changes)) {
    // 密钥的空输入表示保留；只有 null 明确删除，避免占位符或空表单擦除认证。
    if (preserveSecret(key, value) || !Object.hasOwn(paths, key)) continue;
    setJson(config, paths[key]!, normalized(value));
  }
}
function jsonPatch(agent: AgentKind, content: string, config: ConfigObject, changes: Changes) {
  const previous = JSON.stringify(config);
  const paths = agent === 'claude' ? claudePaths : { model: ['model'], modelProvider: ['modelProvider'] };
  validateJsonChanges(agent, changes, config, paths);
  const original = structuredClone(config);
  applyJsonChanges(config, changes, paths);
  try {
    if (agent === 'claude') patchClaudeDisplayName(config, changes);
    else {
      const custom: ConfigObject = { ...original, modelProvider: config.modelProvider };
      if (patchAntigravityModel(custom, changes)) {
        config.customModelsConfig = custom.customModelsConfig;
        config.model = custom.model;
      }
    }
  } catch (error) {
    throw new ModelSettingsError((error as Error).message);
  }
  return JSON.stringify(config) === previous ? content : encodeJson(content, config);
}
function authModeEdits(mode: string, prefix: string[]): Edit[] {
  const edits: Edit[] = [{ path: [...prefix, 'requires_openai_auth'], value: mode === 'native' }];
  if (mode !== 'env') edits.push({ path: [...prefix, 'env_key'], value: null });
  if (mode !== 'token') edits.push({ path: [...prefix, 'experimental_bearer_token'], value: null });
  return edits;
}
function envKeyEdit(provider: ConfigObject, changes: Changes, prefix: string[]): Edit {
  const name = normalized(owns(changes, 'envKey') ? changes.envKey : string(provider.env_key));
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new ModelSettingsError('请填写有效的密钥环境变量名。');
  return { path: [...prefix, 'env_key'], value: name };
}
function apiKeyEdits(mode: string, changes: Changes, prefix: string[]): Edit[] {
  if (!owns(changes, 'apiKey') || preserveSecret('apiKey', changes.apiKey!)) return [];
  if (mode !== 'token') throw new ModelSettingsError('请先选择 API Key 认证。');
  return [{ path: [...prefix, 'experimental_bearer_token'], value: normalized(changes.apiKey) }];
}
function codexAuthEdits(provider: ConfigObject, changes: Changes, prefix: string[]): Edit[] {
  const touched = ['authMode', 'envKey', 'apiKey'].some((key) => owns(changes, key));
  if (!touched) return [];
  const previousMode = codexAuthMode(provider);
  const mode = requestedAuthMode(changes, previousMode);
  if (previousMode === 'command') throw new ModelSettingsError('已有高级认证，请在原始配置中编辑。');
  if (!['env', 'native', 'token'].includes(mode)) throw new ModelSettingsError('不支持的认证方式。');
  const edits = owns(changes, 'authMode') || mode !== previousMode ? authModeEdits(mode, prefix) : [];
  if (mode === 'env') edits.push(envKeyEdit(provider, changes, prefix));
  else if (changes.envKey) throw new ModelSettingsError('请先选择环境变量认证。');
  edits.push(...apiKeyEdits(mode, changes, prefix));
  return edits;
}
function requestedAuthMode(changes: Changes, previous: string) {
  return changes.authMode ?? (changes.apiKey?.trim() ? 'token' : previous);
}
function providerId(config: ConfigObject, changes: Changes) {
  const providers = object(config.model_providers);
  const id = normalized(owns(changes, 'provider') ? changes.provider : string(config.model_provider)) || 'openai';
  if (!['openai', 'agentdeck'].includes(id) && !has(providers, id) && id !== config.model_provider)
    throw new ModelSettingsError('请选择已有服务商或自定义服务。');
  return id;
}
function nativeConnectionEdits(config: ConfigObject, changes: Changes, id: string): Edit[] | undefined {
  if (id === 'openai') {
    if (['authMode', 'envKey', 'apiKey'].some((key) => owns(changes, key)))
      throw new ModelSettingsError('OpenAI 认证请使用原生登录或启动环境中的 OPENAI_API_KEY。');
    return owns(changes, 'baseUrl') ? [{ path: ['openai_base_url'], value: normalized(changes.baseUrl) }] : [];
  }
  if (nativeCodexProvider(config, id)) {
    if (['baseUrl', 'authMode', 'envKey', 'apiKey'].some((key) => owns(changes, key)))
      throw new ModelSettingsError('此服务商沿用原生连接配置，请使用原始配置编辑器。');
    return [];
  }
  return undefined;
}
function customConnectionEdits(config: ConfigObject, changes: Changes, id: string): Edit[] {
  const edits: Edit[] = [];
  const provider = object(object(config.model_providers)[id]);
  const prefix = ['model_providers', id];
  const changingConnection = ['provider', 'displayName', 'baseUrl', 'authMode', 'envKey', 'apiKey'].some((key) =>
    owns(changes, key),
  );
  if (!changingConnection) return edits;
  if (!has(provider, 'name')) edits.push({ path: [...prefix, 'name'], value: id });
  if (owns(changes, 'displayName'))
    edits.push({ path: [...prefix, 'name'], value: normalized(changes.displayName) || id });
  if (!has(provider, 'wire_api')) edits.push({ path: [...prefix, 'wire_api'], value: 'responses' });
  if (owns(changes, 'baseUrl')) edits.push({ path: [...prefix, 'base_url'], value: normalized(changes.baseUrl) });
  edits.push(...codexAuthEdits(provider, changes, prefix));
  return edits;
}
function codexTokenLimitEdits(changes: Changes): Edit[] {
  const fields = [
    ['contextWindow', 'model_context_window', '上下文窗口'],
    ['autoCompactTokenLimit', 'model_auto_compact_token_limit', '自动压缩阈值'],
  ] as const;
  return fields
    .filter(([key]) => owns(changes, key))
    .map(([key, native, label]) => {
      try {
        return { path: [native], value: modelContextWindow(changes[key], label) };
      } catch (error) {
        throw new ModelSettingsError((error as Error).message);
      }
    });
}
function codexEdits(config: ConfigObject, changes: Changes): Edit[] {
  validateKeys(changes, [
    'model',
    'provider',
    'displayName',
    'baseUrl',
    'authMode',
    'envKey',
    'apiKey',
    'reasoningEffort',
    'contextWindow',
    'autoCompactTokenLimit',
  ]);
  const id = providerId(config, changes);
  const edits: Edit[] = [];
  if (owns(changes, 'model')) edits.push({ path: ['model'], value: normalized(changes.model) });
  if (owns(changes, 'provider')) edits.push({ path: ['model_provider'], value: id === 'openai' ? null : id });
  if (owns(changes, 'reasoningEffort'))
    edits.push({ path: ['model_reasoning_effort'], value: normalized(changes.reasoningEffort) });
  edits.push(...codexTokenLimitEdits(changes));
  edits.push(...(nativeConnectionEdits(config, changes, id) ?? customConnectionEdits(config, changes, id)));
  return edits;
}
export function patchModelConfig(agent: AgentKind, content: string, config: ConfigObject, changes: Changes): string {
  if (agent !== 'codex') return jsonPatch(agent, content, config, changes);
  const edits = codexEdits(config, changes);
  try {
    return updateTomlFields(content, edits);
  } catch {
    throw new ModelSettingsError('当前 TOML 结构不能通过表单安全修改，请使用原始配置编辑器。');
  }
}
