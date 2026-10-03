import type { AgentModel } from '@ssh-server/shared';
import type { ModelInfo, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { capabilityId, type NativeCapabilityCatalog, type NativeInvocation } from './capability-types';
import { claudeControl, createClaudeInput, nativeClaudeQuery, type ClaudeQuery, type QueryFn } from './claude-query';

type Entry = NativeCapabilityCatalog['entries'][number];
const safeName = (name: string) =>
  name.length > 0 &&
  name.length <= 200 &&
  !/[\s/\\]/u.test(name) &&
  [...name].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
const usableCommands = (commands: SlashCommand[]) =>
  commands.filter((command) => typeof command.name === 'string' && safeName(command.name));

function compactAvailable(commands: SlashCommand[]): boolean {
  const matching = commands.filter((command) => command.name === 'compact');
  return (
    matching.length === 1 &&
    matching[0]?.builtin === true &&
    !commands.some((command) => command.name !== 'compact' && command.aliases?.includes('compact'))
  );
}

function commandEntry(command: SlashCommand, available: boolean, reason?: string): Entry {
  const connected = command.name === 'compact' || command.name === 'context';
  return {
    id: capabilityId('claude', 'command', command.name),
    kind: 'command',
    name: command.name,
    description: command.description,
    argumentHint: command.argumentHint,
    aliases: command.aliases,
    source: 'Claude Code 原生命令',
    available,
    unavailableReason: reason,
    requiresSession: connected,
    supportsArguments: command.name === 'compact',
    invocation: connected ? { kind: 'command', name: command.name as 'compact' | 'context' } : undefined,
  };
}

function entriesFrom(commands: SlashCommand[], hasContext: boolean): Entry[] {
  const entries: Entry[] = [];
  const names = [...new Set(commands.map((command) => command.name))];
  for (const name of names) {
    const matching = commands.filter((command) => command.name === name);
    const skill = matching.find((command) => command.builtin !== true);
    if (skill)
      entries.push({
        id: capabilityId('claude', 'skill', name),
        kind: 'skill',
        name,
        description: skill.description,
        argumentHint: skill.argumentHint,
        aliases: skill.aliases,
        source: 'Claude 原生技能',
        available: matching.length === 1,
        unavailableReason: matching.length === 1 ? undefined : '存在同名技能或命令，无法确定调用目标',
        requiresSession: false,
        supportsArguments: true,
        invocation: { kind: 'skill', name },
      });
    const builtin = matching.find((command) => command.builtin === true);
    if (builtin && name !== 'compact' && name !== 'context')
      entries.push(commandEntry(builtin, false, '尚未接入网页，请使用 Claude Code CLI'));
  }
  const compact = commands.find((command) => command.name === 'compact' && command.builtin === true);
  const available = compactAvailable(commands);
  entries.push(
    commandEntry(
      compact ?? { name: 'compact', description: '压缩当前原生会话的上下文', argumentHint: '[压缩说明]' },
      available,
      available ? undefined : '当前工作区的原生压缩不可用，可能存在同名技能或别名冲突',
    ),
  );
  entries.push(
    commandEntry(
      { name: 'context', description: '读取当前会话的 Claude 原生上下文估计，不调用模型', argumentHint: '' },
      hasContext,
      hasContext ? undefined : '当前 Claude SDK 不支持上下文查询',
    ),
  );
  return entries;
}

function modelsFrom(models: ModelInfo[]): AgentModel[] {
  return models.map((model) => ({
    id: model.value,
    label: model.displayName,
    description: model.description,
    reasoningEfforts: model.supportedEffortLevels,
  }));
}

async function readCatalog(q: ClaudeQuery, signal: AbortSignal): Promise<NativeCapabilityCatalog> {
  const [commands, models] = await Promise.allSettled([
    claudeControl(q.supportedCommands?.() ?? Promise.reject(new Error('不支持技能发现')), signal),
    claudeControl(q.supportedModels?.() ?? Promise.reject(new Error('不支持模型发现')), signal),
  ]);
  return {
    entries: commands.status === 'fulfilled' ? entriesFrom(usableCommands(commands.value), !!q.getContextUsage) : [],
    models: models.status === 'fulfilled' ? modelsFrom(models.value) : [],
    warnings: [
      ...(commands.status === 'rejected' ? ['Claude 技能与命令读取失败，请刷新重试'] : []),
      ...(models.status === 'rejected' ? ['Claude 模型建议读取失败，请刷新重试'] : []),
    ],
  };
}

/** 工厂仅为控制接口测试注入；生产导出保持按工作区发现的短生命周期接口。 */
export function createClaudeCapabilityDiscovery(queryFn: QueryFn = nativeClaudeQuery) {
  return async (dir: string, options: { signal?: AbortSignal } = {}): Promise<NativeCapabilityCatalog> => {
    if (options.signal?.aborted) throw new Error('Claude 能力读取已取消');
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const input = createClaudeInput();
    let q: ClaudeQuery | undefined;
    try {
      q = queryFn({
        prompt: input.prompt,
        options: {
          cwd: dir,
          settingSources: ['user', 'project', 'local'],
          persistSession: false,
          abortController: controller,
        },
      });
      const catalog = await readCatalog(q, controller.signal);
      if (controller.signal.aborted) throw new Error('Claude 能力读取已取消');
      return catalog;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      input.close();
      q?.close?.();
    }
  };
}

export const discoverClaudeCapabilities = createClaudeCapabilityDiscovery();

function assertSkill(commands: SlashCommand[], name: string) {
  const matching = commands.filter((command) => command.name === name);
  if (matching.length !== 1 || matching[0]?.builtin === true)
    throw new Error('所选 Claude 技能已失效或存在同名歧义，请刷新后重试');
}

/** 校验与投递共用一个 Query，不能用先前目录快照代替原生解析结果。 */
export async function claudeInvocationText(
  q: ClaudeQuery,
  invocation: NativeInvocation | undefined,
  text: string,
  signal: AbortSignal,
): Promise<string> {
  if (!invocation) return text;
  if (invocation.kind === 'command' && invocation.name === 'context') throw new Error('上下文查询必须使用原生控制接口');
  if (!q.supportedCommands) throw new Error('当前 Claude SDK 不支持能力校验');
  const commands = usableCommands(await claudeControl(q.supportedCommands(), signal));
  if (invocation.kind === 'command') {
    if (!compactAvailable(commands)) throw new Error('当前工作区的原生压缩不可用，存在缺失或同名命令冲突');
  } else {
    assertSkill(commands, invocation.name);
  }
  return `/${invocation.name}${text.trim() ? ` ${text}` : ''}`;
}
