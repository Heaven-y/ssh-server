import type {
  AgentKind,
  LaunchEnvironmentDocument,
  NativeModelSettingsDocument,
  NativeModelSettingsInput,
} from '@agentdeck/shared';
import { NativeModelSettingsInputSchema } from '@agentdeck/shared';
import { createNativeResourcesService, type NativeResourcesService } from './native-resources';
import type { LaunchEnvironment } from './launch-environment';
import { antigravityFields, claudeFields, codexFields, parseModelConfig } from './model-settings-fields';
import { ModelSettingsError, patchModelConfig } from './model-settings-patch';
import { NativeResourceError } from './native-resources-errors';

type Deps = { resources?: NativeResourcesService; environment?: Pick<LaunchEnvironment, 'read'> };
function environmentWarnings(agent: AgentKind, provider: unknown, environment?: LaunchEnvironmentDocument) {
  if (!environment) return [];
  const overrides = environment.variables
    .filter((variable) => variable.source === 'configured')
    .map((variable) => variable.name);
  const warnings = overrides.length
    ? [`工作台已设置启动变量：${overrides.join('、')}。这些变量会传给新启动的 CLI；可在启动环境中恢复继承。`]
    : [];
  if (
    agent === 'antigravity' &&
    provider === 'gemini' &&
    !environment.variables.find((variable) => variable.name === 'GEMINI_API_KEY')?.hasValue
  )
    warnings.push('Gemini 模式尚未检测到 GEMINI_API_KEY，请在启动环境中配置后开始新会话。');
  return warnings;
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
  async function describe(
    agent: AgentKind,
    document: Awaited<ReturnType<typeof open>>,
  ): Promise<NativeModelSettingsDocument> {
    const config = parseModelConfig(agent, document.content);
    const warnings: string[] = [];
    try {
      warnings.push(...environmentWarnings(agent, config.modelProvider, await deps.environment?.read(agent)));
    } catch {
      warnings.push('启动环境状态暂时无法读取，请检查启动环境设置。');
    }
    const fields =
      agent === 'codex'
        ? codexFields(config)
        : { fields: agent === 'claude' ? claudeFields(config) : antigravityFields(config) };
    return {
      agent,
      revision: document.revision,
      displayPath: document.resource.displayPath,
      ...fields,
      warnings: [
        ...warnings,
        ...(config.profile ? ['检测到旧版 profile 选择；新版 CLI 的 profile 格式已变化，请在原始配置中核对。'] : []),
      ],
    };
  }
  return {
    async read(agent: AgentKind) {
      return describe(agent, await open(agent));
    },
    async save(agent: AgentKind, input: NativeModelSettingsInput) {
      const parsed = NativeModelSettingsInputSchema.safeParse(input);
      if (!parsed.success) throw new ModelSettingsError('模型配置请求格式不正确。');
      const document = await open(agent);
      if (input.revision !== document.revision) throw new NativeResourceError('revision_conflict');
      const config = parseModelConfig(agent, document.content);
      const content = patchModelConfig(agent, document.content, config, parsed.data.changes);
      if (content === document.content) return describe(agent, document);
      const saved = await resources.save(agent, document.resource.id, { content, revision: document.revision });
      return describe(agent, { ...saved, content });
    },
  };
}
export type ModelSettingsService = ReturnType<typeof createModelSettingsService>;
