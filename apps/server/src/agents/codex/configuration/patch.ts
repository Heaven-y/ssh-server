import { updateTomlFields } from '../../../platform/files/toml-fields';
import { has, object, string, type ConfigObject } from '../../common/configuration/fields';
import {
  ModelSettingsError,
  normalized,
  owns,
  preserveSecret,
  validateKeys,
  type Changes,
  type Edit,
} from '../../common/configuration/patch';
import { modelContextWindow } from '../../common/configuration/token-count';
import { codexAuthMode, nativeCodexProvider } from './fields';
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
export function patch(content: string, config: ConfigObject, changes: Changes): string {
  const edits = codexEdits(config, changes);
  try {
    return updateTomlFields(content, edits);
  } catch {
    throw new ModelSettingsError('当前 TOML 结构不能通过表单安全修改，请使用原始配置编辑器。');
  }
}
