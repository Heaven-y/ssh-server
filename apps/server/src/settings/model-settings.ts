import type { AgentKind, NativeModelSettingsDocument, NativeModelSettingsInput } from '@agentdeck/shared';
import { NativeModelSettingsInputSchema } from '@agentdeck/shared';
import { createNativeResourcesService, type NativeResourcesService } from './native-resources';
import { antigravityFields, claudeFields, codexFields, parseModelConfig } from './model-settings-fields';
import { ModelSettingsError, patchModelConfig } from './model-settings-patch';
import { NativeResourceError } from './native-resources-errors';
import {
  antigravitySelectionChanges,
  nativeAntigravityModels,
  type AntigravityModelCatalog,
} from './model-settings-antigravity';
import {
  advancedModelEnvironmentWarnings,
  antigravityConnectionChanges,
  modelConnectionFields,
  modelEnvironmentWarnings,
  modelSettingsRevision,
  nativeModelChanges,
  prepareModelConnection,
  readModelEnvironment,
  type ModelSettingsEnvironment,
} from './model-settings-environment';

type Deps = {
  resources?: NativeResourcesService;
  environment?: ModelSettingsEnvironment;
  antigravityModels?: AntigravityModelCatalog;
};
type NativeDocument = Awaited<ReturnType<NativeResourcesService['open']>>;
type EnvironmentSnapshot = Awaited<ReturnType<typeof readModelEnvironment>>;

function describe(
  agent: AgentKind,
  document: NativeDocument,
  environment: EnvironmentSnapshot,
): NativeModelSettingsDocument {
  const config = parseModelConfig(agent, document.content);
  const fields =
    agent === 'codex'
      ? codexFields(config)
      : { fields: agent === 'claude' ? claudeFields(config) : antigravityFields(config) };
  if (agent === 'antigravity') fields.fields.push(...modelConnectionFields(environment));
  return {
    agent,
    revision: modelSettingsRevision(document.revision, environment),
    displayPath: document.resource.displayPath,
    ...fields,
    warnings: [
      ...modelEnvironmentWarnings(config.modelProvider, environment),
      ...(config.profile ? ['检测到旧版 profile 选择；新版 CLI 的 profile 格式已变化，请在原始配置中核对。'] : []),
    ],
  };
}

/** 可视表单与原文编辑器共用同一文件事务、revision 和路径安全检查。 */
export function createModelSettingsService(deps: Deps = {}) {
  const resources = deps.resources ?? createNativeResourcesService();
  async function open(agent: AgentKind) {
    const catalog = await resources.list(agent);
    const target = catalog.entries.find((entry) => entry.kind === 'settings' && entry.scope === 'user');
    if (!target) throw new NativeResourceError('resource_missing');
    return resources.open(agent, target.id);
  }
  async function saveNative(agent: AgentKind, document: NativeDocument, content: string): Promise<NativeDocument> {
    if (content === document.content) {
      const current = await resources.open(agent, document.resource.id);
      if (current.revision !== document.revision) throw new NativeResourceError('revision_conflict');
      return current;
    }
    const saved = await resources.save(agent, document.resource.id, { content, revision: document.revision });
    return { ...saved, content };
  }
  async function response(agent: AgentKind, document: NativeDocument, environment: EnvironmentSnapshot) {
    const result = describe(agent, document, environment);
    const config = parseModelConfig(agent, document.content);
    result.warnings.push(...(await advancedModelEnvironmentWarnings(agent, config, deps.environment)));
    return result;
  }
  return {
    async read(agent: AgentKind) {
      const document = await open(agent);
      return response(agent, document, await readModelEnvironment(agent, deps.environment));
    },
    async save(agent: AgentKind, input: NativeModelSettingsInput) {
      const parsed = NativeModelSettingsInputSchema.safeParse(input);
      if (!parsed.success) throw new ModelSettingsError('模型配置请求格式不正确。');
      const document = await open(agent);
      const environment = await readModelEnvironment(agent, deps.environment);
      if (input.revision !== modelSettingsRevision(document.revision, environment))
        throw new NativeResourceError('revision_conflict');
      const config = parseModelConfig(agent, document.content);
      const changes =
        agent === 'antigravity'
          ? antigravityConnectionChanges(parsed.data.changes, config, environment)
          : parsed.data.changes;
      const nativeChanges =
        agent === 'antigravity'
          ? await antigravitySelectionChanges(
              config,
              nativeModelChanges(changes, environment),
              deps.antigravityModels ?? nativeAntigravityModels,
            )
          : changes;
      const content = patchModelConfig(agent, document.content, config, nativeChanges);
      const connection = prepareModelConnection(agent === 'antigravity' ? changes : {}, deps.environment, environment);
      const environmentSaved = await connection.save();
      let saved: NativeDocument;
      try {
        saved = await saveNative(agent, document, content);
      } catch (error) {
        await connection.restore(environmentSaved);
        throw error;
      }
      // 回显使用已提交的快照，不重新解密，也不能因回显失败撤销已提交的连接。
      return response(agent, saved, environmentSaved);
    },
  };
}
export type ModelSettingsService = ReturnType<typeof createModelSettingsService>;
