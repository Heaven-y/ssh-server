import path from 'node:path';
import type { AgentCapabilities, AgentKind, AgentModel, CapabilitySelection, Workspace } from '@agentdeck/shared';
import type { CapabilityProvider, NativeCapabilityCatalog, NativeInvocation } from '../agents/capability-types';
import { SessionError } from './sessions';
import { createModelCache, type CachedModelCatalog } from './model-cache';

type Entry = NativeCapabilityCatalog['entries'][number];
function typedCommand(text: string): { name: string; text: string } | undefined {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return match ? { name: match[1]!, text: match[2] ?? '' } : undefined;
}
function chooseEntry(entries: Entry[], selection?: CapabilitySelection, name?: string): Entry {
  const exact = entries.filter((entry) => (selection ? entry.id === selection.id : entry.name === name));
  const matches = exact.length || selection ? exact : entries.filter((entry) => entry.aliases?.includes(name ?? ''));
  if (matches.length !== 1)
    throw new SessionError(400, 'capability_missing', '技能或命令已变化、未知或存在歧义，请从当前能力列表重新选择');
  const entry = matches[0]!;
  if (!entry.available || !entry.invocation)
    throw new SessionError(
      400,
      'capability_unavailable',
      entry.unavailableReason ?? '此能力尚未接入网页，请使用本机 CLI',
    );
  return entry;
}

const AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
};

function providerOf(providers: Partial<Record<AgentKind, CapabilityProvider>>, agent: AgentKind): CapabilityProvider {
  const provider = providers[agent];
  if (!provider) throw new SessionError(503, 'agent_unavailable', `${AGENT_LABELS[agent]} 适配器尚未接入`);
  return provider;
}

function prepareEntry(entry: Entry, args: string, sessionId?: string) {
  if (entry.requiresSession && !sessionId)
    throw new SessionError(400, 'session_required', '此命令需要已有会话，请先开始或打开一段对话');
  if (!entry.supportsArguments && args.trim())
    throw new SessionError(400, 'arguments_unsupported', '此命令不接受附加参数，请清空输入后调用');
  return { text: args, invocation: structuredClone(entry.invocation) };
}

function retainModels(partial: AgentModel[], previous: AgentModel[]): AgentModel[] {
  const ids = new Set(partial.map((model) => model.id));
  return [...partial, ...previous.filter((model) => !ids.has(model.id))];
}

export function createCapabilitiesService(
  providers: Partial<Record<AgentKind, CapabilityProvider>>,
  options: { configDir?: string } = {},
) {
  const cache = new Map<string, NativeCapabilityCatalog>();
  const models = new Map<string, CachedModelCatalog | undefined>();
  const refreshing = new Map<string, symbol>();
  const revisions: Partial<Record<AgentKind, number>> = {};
  const disk = options.configDir ? createModelCache(options.configDir) : undefined;
  function keyOf(directory: string, agent: AgentKind) {
    const dir = path.resolve(directory);
    return JSON.stringify([agent, process.platform === 'win32' ? dir.toLowerCase() : dir]);
  }
  function publicCatalog(
    agent: AgentKind,
    catalog?: NativeCapabilityCatalog,
    savedModels?: CachedModelCatalog,
  ): AgentCapabilities {
    if (!catalog)
      return {
        agent,
        discovered: savedModels?.current ?? false,
        commandsDiscovered: false,
        ...structuredClone(savedModels?.snapshot ?? { models: [] }),
        entries: [],
        warnings: savedModels ? [] : ['打开模型菜单或点击刷新即可读取 CLI 能力。'],
      };
    const visible = structuredClone(catalog);
    return {
      ...visible,
      agent,
      discovered: true,
      commandsDiscovered: true,
      entries: visible.entries.map((entry) => {
        delete entry.invocation;
        return entry;
      }),
    };
  }
  async function discover(directory: string, agent: AgentKind, signal?: AbortSignal) {
    try {
      signal?.throwIfAborted();
      const catalog = await providerOf(providers, agent)(directory, signal);
      signal?.throwIfAborted();
      return catalog;
    } catch (error) {
      if (error instanceof SessionError) throw error;
      throw new SessionError(
        503,
        'capabilities_unavailable',
        `${AGENT_LABELS[agent]} 能力读取失败，请检查本机运行时与配置`,
      );
    }
  }
  async function readDirectory(directory: string, agent: AgentKind): Promise<AgentCapabilities> {
    const key = keyOf(directory, agent);
    const revision = revisions[agent];
    if (!cache.has(key) && !models.has(key)) {
      const saved = await disk?.read(agent, key);
      if (revision === revisions[agent]) models.set(key, saved);
    }
    return publicCatalog(agent, cache.get(key), models.get(key));
  }
  async function refreshDirectory(
    directory: string,
    agent: AgentKind,
    signal?: AbortSignal,
  ): Promise<AgentCapabilities> {
    const key = keyOf(directory, agent);
    const request = Symbol();
    refreshing.set(key, request);
    const assertCurrent = () => {
      signal?.throwIfAborted();
      if (refreshing.get(key) !== request)
        throw new SessionError(409, 'capabilities_refresh_superseded', '已有较新的能力刷新请求，请读取最新目录');
    };
    try {
      const catalog = structuredClone(await discover(directory, agent, signal));
      assertCurrent();
      if (catalog.modelWarning) {
        const previous = await readDirectory(directory, agent);
        catalog.models = retainModels(catalog.models, previous.models);
        catalog.defaultModel ??= previous.defaultModel;
        if (catalog.defaultModel === previous.defaultModel)
          catalog.defaultReasoningEffort ??= previous.defaultReasoningEffort;
      } else if (catalog.models.length || !catalog.warnings.length || catalog.modelWarning === '') {
        await disk?.write(agent, key, catalog, () => refreshing.get(key) === request && !signal?.aborted);
      }
      assertCurrent();
      cache.set(key, structuredClone(catalog));
      return publicCatalog(agent, catalog);
    } finally {
      if (refreshing.get(key) === request) refreshing.delete(key);
    }
  }
  return {
    async invalidate(agent: AgentKind): Promise<void> {
      revisions[agent] = (revisions[agent] ?? 0) + 1;
      // 保存后在途的旧目录也失效，不能晚于新配置重新填回缓存。
      for (const key of new Set([...cache.keys(), ...models.keys(), ...refreshing.keys()])) {
        if ((JSON.parse(key) as string[])[0] !== agent) continue;
        cache.delete(key);
        models.delete(key);
        refreshing.delete(key);
      }
      await disk?.invalidate(agent);
    },
    read(ws: Workspace, agent: AgentKind): Promise<AgentCapabilities> {
      return readDirectory(ws.dir, agent);
    },
    refresh(ws: Workspace, agent: AgentKind, signal?: AbortSignal): Promise<AgentCapabilities> {
      return refreshDirectory(ws.dir, agent, signal);
    },
    readDirectory,
    refreshDirectory,
    prepare(
      ws: Workspace,
      agent: AgentKind,
      input: { text: string; selection?: CapabilitySelection; sessionId?: string },
      signal?: AbortSignal,
    ): Promise<{ text: string; invocation?: NativeInvocation }> {
      return Promise.resolve().then(() => {
        const { text, selection, sessionId } = input;
        const command = selection ? undefined : typedCommand(text);
        if (!selection && !command) return { text };
        signal?.throwIfAborted();
        const catalog = cache.get(keyOf(ws.dir, agent));
        if (!catalog)
          throw new SessionError(409, 'capabilities_not_refreshed', '请先点击“刷新能力”，再使用技能或斜杠命令');
        const entry = chooseEntry(catalog.entries, selection, command?.name);
        return prepareEntry(entry, command ? command.text : text, sessionId);
      });
    },
  };
}
export type CapabilitiesService = ReturnType<typeof createCapabilitiesService>;
