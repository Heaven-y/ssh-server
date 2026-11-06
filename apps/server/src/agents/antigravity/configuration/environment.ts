import type {
  LaunchEnvironmentDocument,
  LaunchEnvironmentInput,
  ModelSettingField,
  NativeModelSettingsInput,
} from '@agentdeck/shared/settings';
import type { ModelSettingsEnvironment, EnvironmentSnapshot as Snapshot } from '../../common/configuration/contracts';
import { NativeResourceError } from '../../common/configuration/errors';
import { field, type ConfigObject } from '../../common/configuration/fields';
import { ModelSettingsError } from '../../common/configuration/patch';
import { legacyAntigravityBaseUrl } from './custom-model';

type Changes = NativeModelSettingsInput['changes'];
type Variable = LaunchEnvironmentInput['variables'][number];
const connectionVariables = { baseUrl: 'GOOGLE_GEMINI_BASE_URL', apiKey: 'GEMINI_API_KEY' } as const;

/** 读取回显与回滚所需的一致快照，密钥只保留在服务端的本次调用内。 */
export async function readModelEnvironment(environment?: ModelSettingsEnvironment): Promise<Snapshot | undefined> {
  if (!environment) return;
  const document = await environment.read('antigravity');
  const resolved = await environment.resolve('antigravity');
  if ((await environment.read('antigravity')).revision !== document.revision)
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

function requestedVariables(changes: Changes): Variable[] {
  return Object.entries(connectionVariables).flatMap(([key, name]) => requestedVariable(changes, key, name));
}

function requestedVariable(changes: Changes, key: string, name: string): Variable[] {
  if (!Object.hasOwn(changes, key)) return [];
  const value = key === 'baseUrl' ? geminiBaseUrl(changes[key]) : changes[key];
  const trimmed = value?.trim();
  if (key === 'apiKey' && value !== null && !trimmed) return [];
  return [trimmed ? { name, mode: 'set', value: trimmed } : { name, mode: 'disabled' }];
}

/** agy 自行追加 v1beta，表单接受常见完整 API 根并只去掉末尾重复版本段。 */
function geminiBaseUrl(value: string | null | undefined): string | null | undefined {
  if (!value?.trim()) return value;
  const url = new URL(value.trim());
  url.pathname = url.pathname.replace(/\/v1beta\/?$/, '').replace(/\/$/, '');
  return url.toString().replace(/\/$/, '');
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

/** 迁移旧 URI 时只补缺失地址；用户显式设置、继承的地址或停用选择都优先。 */
export function antigravityConnectionChanges(changes: Changes, config: ConfigObject, snapshot?: Snapshot): Changes {
  if (Object.hasOwn(changes, 'baseUrl') || snapshot?.resolved.GOOGLE_GEMINI_BASE_URL) return changes;
  const prior = snapshot?.document.variables.find((variable) => variable.name === 'GOOGLE_GEMINI_BASE_URL');
  if (prior?.mode === 'disabled') return changes;
  const modelChange = ['model', 'displayName', 'contextWindow', 'modelProvider'].some((key) =>
    Object.hasOwn(changes, key),
  );
  if (!modelChange) return changes;
  const endpoint = legacyAntigravityBaseUrl({ ...config, model: changes.model ?? config.model });
  return endpoint ? { ...changes, baseUrl: endpoint } : changes;
}
