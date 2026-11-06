import type { AgentKind, AgentModel } from '@agentdeck/shared/conversation';
import type { NativeModelSettingsDocument, NativeModelSettingsInput } from '@agentdeck/shared/settings';
import { NativeModelSettingsInputSchema } from '@agentdeck/shared/settings';
import type { EnvironmentSnapshot, ModelSettingsEnvironment } from '../agents/common/configuration/contracts';
import { modelSettingsRevision } from '../agents/common/configuration/environment';
import { NativeResourceError } from '../agents/common/configuration/errors';
import { parseModelConfig } from '../agents/common/configuration/fields';
import { ModelSettingsError } from '../agents/common/configuration/patch';
import { cliConfigurations } from '../agents/registry';
import { createNativeResourcesService, type NativeResourcesService } from './native-resources';
type Deps = {
  resources?: NativeResourcesService;
  environment?: ModelSettingsEnvironment;
  antigravityModels?: () => Promise<AgentModel[]>;
};
type NativeDocument = Awaited<ReturnType<NativeResourcesService['open']>>;

function describe(
  agent: AgentKind,
  document: NativeDocument,
  environment: EnvironmentSnapshot | undefined,
): NativeModelSettingsDocument {
  const adapter = cliConfigurations[agent];
  const config = parseModelConfig(adapter.format, document.content);
  return {
    agent,
    revision: modelSettingsRevision(document.revision, environment),
    displayPath: document.resource.displayPath,
    ...adapter.describe(config, environment),
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
  async function response(agent: AgentKind, document: NativeDocument, environment: EnvironmentSnapshot | undefined) {
    const result = describe(agent, document, environment);
    const config = parseModelConfig(cliConfigurations[agent].format, document.content);
    result.warnings.push(...(await cliConfigurations[agent].advancedWarnings(config, deps.environment)));
    return result;
  }
  return {
    async read(agent: AgentKind) {
      const document = await open(agent);
      return response(agent, document, await cliConfigurations[agent].readEnvironment(deps.environment));
    },
    async save(agent: AgentKind, input: NativeModelSettingsInput) {
      const parsed = NativeModelSettingsInputSchema.safeParse(input);
      if (!parsed.success) throw new ModelSettingsError('模型配置请求格式不正确。');
      const document = await open(agent);
      const environment = await cliConfigurations[agent].readEnvironment(deps.environment);
      if (input.revision !== modelSettingsRevision(document.revision, environment))
        throw new NativeResourceError('revision_conflict');
      const config = parseModelConfig(cliConfigurations[agent].format, document.content);
      const adapter = cliConfigurations[agent];
      const prepared = await adapter.prepare(config, parsed.data.changes, environment, {
        environment: deps.environment,
        modelCatalog: deps.antigravityModels,
      });
      const content = adapter.patch(document.content, config, prepared.changes);
      const connection = prepared.connection;
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
