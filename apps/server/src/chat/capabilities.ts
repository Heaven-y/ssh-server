import path from 'node:path';
import type { AgentCapabilities, AgentKind, CapabilitySelection, Workspace } from '@agentdeck/shared';
import type { CapabilityProvider, NativeCapabilityCatalog, NativeInvocation } from '../agents/capability-types';
import { SessionError } from './sessions';

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

export function createCapabilitiesService(providers: Partial<Record<AgentKind, CapabilityProvider>>) {
  const cache = new Map<string, NativeCapabilityCatalog>();
  const refreshing = new Map<string, symbol>();
  function keyOf(ws: Workspace, agent: AgentKind) {
    const dir = path.resolve(ws.dir);
    return JSON.stringify([ws.id, process.platform === 'win32' ? dir.toLowerCase() : dir, agent]);
  }
  function publicCatalog(agent: AgentKind, catalog?: NativeCapabilityCatalog): AgentCapabilities {
    if (!catalog)
      return { agent, models: [], entries: [], warnings: ['能力尚未刷新；请点击“刷新能力”检查账号与模型清单。'] };
    const visible = structuredClone(catalog);
    return {
      ...visible,
      agent,
      entries: visible.entries.map((entry) => {
        delete entry.invocation;
        return entry;
      }),
    };
  }
  async function discover(ws: Workspace, agent: AgentKind, signal?: AbortSignal) {
    try {
      signal?.throwIfAborted();
      const catalog = await providerOf(providers, agent)(ws.dir, signal);
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
  return {
    read(ws: Workspace, agent: AgentKind): Promise<AgentCapabilities> {
      return Promise.resolve(publicCatalog(agent, cache.get(keyOf(ws, agent))));
    },
    async refresh(ws: Workspace, agent: AgentKind, signal?: AbortSignal): Promise<AgentCapabilities> {
      const key = keyOf(ws, agent);
      const request = Symbol();
      refreshing.set(key, request);
      try {
        const catalog = await discover(ws, agent, signal);
        if (refreshing.get(key) !== request)
          throw new SessionError(409, 'capabilities_refresh_superseded', '已有较新的能力刷新请求，请读取最新目录');
        cache.set(key, structuredClone(catalog));
        return publicCatalog(agent, catalog);
      } finally {
        if (refreshing.get(key) === request) refreshing.delete(key);
      }
    },
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
        const catalog = cache.get(keyOf(ws, agent));
        if (!catalog)
          throw new SessionError(409, 'capabilities_not_refreshed', '请先点击“刷新能力”，再使用技能或斜杠命令');
        const entry = chooseEntry(catalog.entries, selection, command?.name);
        return prepareEntry(entry, command ? command.text : text, sessionId);
      });
    },
  };
}
export type CapabilitiesService = ReturnType<typeof createCapabilitiesService>;
