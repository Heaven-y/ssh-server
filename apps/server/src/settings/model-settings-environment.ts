import { createHash } from 'node:crypto';
import type {
  AgentKind,
  LaunchEnvironmentDocument,
  LaunchEnvironmentInput,
  ModelSettingField,
  NativeModelSettingsInput,
} from '@agentdeck/shared';
import type { LaunchEnvironment } from './launch-environment';
import { NativeResourceError } from './native-resources-errors';
import { ModelSettingsError } from './model-settings-patch';
import { field, object, string, type ConfigObject } from './model-settings-fields';

export type ModelSettingsEnvironment = Pick<LaunchEnvironment, 'read' | 'save' | 'resolve'>;
type Snapshot = { document: LaunchEnvironmentDocument; resolved: NodeJS.ProcessEnv };
type Changes = NativeModelSettingsInput['changes'];
type Variable = LaunchEnvironmentInput['variables'][number];
const connectionVariables = { baseUrl: 'GOOGLE_GEMINI_BASE_URL', apiKey: 'GEMINI_API_KEY' } as const;

export const modelSettingsRevision = (native: string, snapshot?: Snapshot) =>
  snapshot ? createHash('sha256').update(`${native}:${snapshot.document.revision}`).digest('hex') : native;

/** 读取回显与回滚所需的一致快照，密钥只保留在服务端的本次调用内。 */
export async function readModelEnvironment(
  agent: AgentKind,
  environment?: ModelSettingsEnvironment,
): Promise<Snapshot | undefined> {
  if (agent !== 'antigravity' || !environment) return;
  const document = await environment.read(agent);
  const resolved = await environment.resolve(agent);
  if ((await environment.read(agent)).revision !== document.revision)
    throw new NativeResourceError('revision_conflict');
  return { document, resolved };
}

export function modelConnectionFields(snapshot?: Snapshot): ModelSettingField[] {
  return [
    field('baseUrl', '服务地址', snapshot?.resolved.GOOGLE_GEMINI_BASE_URL, { placeholder: 'Gemini API 默认地址' }),
    field('apiKey', 'API Key', '', { secret: true, hasValue: !!snapshot?.resolved.GEMINI_API_KEY }),
  ];
}

export function modelEnvironmentWarnings(provider: unknown, snapshot?: Snapshot): string[] {
  return provider === 'gemini' && snapshot && !snapshot.resolved.GEMINI_API_KEY
    ? ['填写 API Key 后可使用 Gemini 模型。']
    : [];
}

function applicableVariables(agent: AgentKind, config: ConfigObject): string[] {
  if (agent === 'claude') return ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
  const provider = string(config.model_provider) || 'openai';
  if (provider === 'openai') return ['OPENAI_BASE_URL', 'OPENAI_API_KEY'];
  return [string(object(object(config.model_providers)[provider]).env_key)];
}

/** 只读取状态供高级设置提示，不解密、列出变量或推断 CLI 的认证优先级。 */
export async function advancedModelEnvironmentWarnings(
  agent: AgentKind,
  config: ConfigObject,
  environment?: ModelSettingsEnvironment,
): Promise<string[]> {
  if (agent === 'antigravity' || !environment) return [];
  try {
    const names = applicableVariables(agent, config);
    const metadata = await environment.read(agent);
    const affected = metadata.variables.some(
      (variable) => names.includes(variable.name) && variable.mode !== 'inherit',
    );
    return affected ? ['连接另有高级设置，可在启动环境中查看。'] : [];
  } catch {
    // 此提示不参与保存事务，读取状态失败不能把已保存配置报告成写入失败。
    return [];
  }
}

function requestedVariables(changes: Changes): Variable[] {
  return Object.entries(connectionVariables).flatMap(([key, name]) => {
    if (!Object.hasOwn(changes, key)) return [];
    const value = changes[key];
    if (key === 'apiKey' && value !== null && !value?.trim()) return [];
    return [{ name, mode: value?.trim() ? 'set' : 'disabled', ...(value?.trim() ? { value: value.trim() } : {}) }];
  });
}

function originalVariables(snapshot: Snapshot, variables: Variable[]): Variable[] {
  return variables.map(({ name }) => {
    const prior = snapshot.document.variables.find((variable) => variable.name === name);
    if (!prior) throw new ModelSettingsError('API 连接配置暂不可用。');
    return { name, mode: prior.mode, ...(prior.mode === 'set' ? { value: snapshot.resolved[name] } : {}) };
  });
}

function updatedSnapshot(snapshot: Snapshot, document: LaunchEnvironmentDocument, variables: Variable[]): Snapshot {
  const resolved = { ...snapshot.resolved };
  for (const variable of variables) resolved[variable.name] = variable.mode === 'set' ? variable.value : undefined;
  return { document, resolved };
}

/** 先写连接，原生文件失败才回滚；revision 防止回滚覆盖期间发生的其他连接编辑。 */
export function prepareModelConnection(changes: Changes, environment?: ModelSettingsEnvironment, snapshot?: Snapshot) {
  const variables = requestedVariables(changes);
  if (variables.length && (!environment || !snapshot)) throw new ModelSettingsError('API 连接配置暂不可用。');
  const previous = snapshot ? originalVariables(snapshot, variables) : [];
  return {
    async save(): Promise<Snapshot | undefined> {
      if (!variables.length) return snapshot;
      const document = await environment!.save('antigravity', { revision: snapshot!.document.revision, variables });
      return updatedSnapshot(snapshot!, document, variables);
    },
    async restore(saved: Snapshot | undefined) {
      if (!saved || !variables.length) return;
      await environment!.save('antigravity', { revision: saved.document.revision, variables: previous });
    },
  };
}

/** 地址只用于本次自定义模型映射，密钥由连接事务接收，不进入原生 JSON。 */
export function nativeModelChanges(changes: Changes, snapshot?: Snapshot): Changes {
  const native = { ...changes };
  delete native.apiKey;
  const needsAddress = ['model', 'displayName', 'contextWindow'].some((key) => Object.hasOwn(changes, key));
  if (needsAddress && !Object.hasOwn(native, 'baseUrl') && snapshot?.resolved.GOOGLE_GEMINI_BASE_URL)
    native.baseUrl = snapshot.resolved.GOOGLE_GEMINI_BASE_URL;
  return native;
}
