import type { AgentCapabilities, AgentKind, CapabilitySelection, Workspace } from '@ssh-server/shared';
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

export function createCapabilitiesService(providers: Record<AgentKind, CapabilityProvider>) {
  async function discover(ws: Workspace, agent: AgentKind, signal?: AbortSignal) {
    try {
      signal?.throwIfAborted();
      const catalog = await providers[agent](ws.localDir, signal);
      signal?.throwIfAborted();
      return catalog;
    } catch (error) {
      if (error instanceof SessionError) throw error;
      throw new SessionError(
        503,
        'capabilities_unavailable',
        `${agent === 'claude' ? 'Claude Code' : 'Codex'} 能力读取失败，请检查本机运行时与配置`,
      );
    }
  }
  return {
    async read(ws: Workspace, agent: AgentKind, signal?: AbortSignal): Promise<AgentCapabilities> {
      const catalog = await discover(ws, agent, signal);
      return {
        agent,
        models: catalog.models,
        warnings: catalog.warnings,
        entries: catalog.entries.map((entry) => {
          const visible = { ...entry };
          delete visible.invocation;
          return visible;
        }),
      };
    },
    async prepare(
      ws: Workspace,
      agent: AgentKind,
      input: { text: string; selection?: CapabilitySelection; sessionId?: string },
      signal?: AbortSignal,
    ): Promise<{ text: string; invocation?: NativeInvocation }> {
      const { text, selection, sessionId } = input;
      const command = selection ? undefined : typedCommand(text);
      if (!selection && !command) return { text };
      const catalog = await discover(ws, agent, signal);
      const entry = chooseEntry(catalog.entries, selection, command?.name);
      if (entry.requiresSession && !sessionId)
        throw new SessionError(400, 'session_required', '此命令需要已有会话，请先开始或打开一段对话');
      const args = command ? command.text : text;
      if (!entry.supportsArguments && args.trim())
        throw new SessionError(400, 'arguments_unsupported', '此命令不接受附加参数，请清空输入后调用');
      return { text: args, invocation: entry.invocation };
    },
  };
}
export type CapabilitiesService = ReturnType<typeof createCapabilitiesService>;
