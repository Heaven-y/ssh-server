import type { AgentKind } from '@agentdeck/shared/conversation';
import type { SessionProvider } from '../agents/contracts';
import { SessionError } from '../agents/errors';

/** 会话读取和能力发现可并发，安装必须等这些原生进程全部结束。 */
export function createCliActivity() {
  const readers = new Map<AgentKind, number>();
  const maintaining = new Set<AgentKind>();
  const busy = () => new SessionError(409, 'agent_busy', 'CLI 正在读取、运行或更新，请结束后重试');
  return {
    async run<T>(agent: AgentKind, operation: () => Promise<T>): Promise<T> {
      if (maintaining.has(agent)) throw busy();
      readers.set(agent, (readers.get(agent) ?? 0) + 1);
      try {
        return await operation();
      } finally {
        readers.set(agent, readers.get(agent)! - 1);
      }
    },
    async exclusive<T>(agent: AgentKind, operation: () => Promise<T>): Promise<T> {
      if (maintaining.has(agent) || readers.get(agent)) throw busy();
      maintaining.add(agent);
      try {
        return await operation();
      } finally {
        maintaining.delete(agent);
      }
    },
  };
}
export type CliActivity = ReturnType<typeof createCliActivity>;

export function guardSessionProvider(
  agent: AgentKind,
  provider: SessionProvider,
  activity: CliActivity,
): SessionProvider {
  const page = provider.page?.bind(provider);
  const subagents = provider.subagents?.bind(provider);
  return {
    ...provider,
    list: (...args) => activity.run(agent, () => provider.list(...args)),
    read: (...args) => activity.run(agent, () => provider.read(...args)),
    assertBelongs: (...args) => activity.run(agent, () => provider.assertBelongs(...args)),
    mutate: (...args) => activity.run(agent, () => provider.mutate(...args)),
    fork: (...args) => activity.run(agent, () => provider.fork(...args)),
    ...(page ? { page: (...args: Parameters<typeof page>) => activity.run(agent, () => page(...args)) } : {}),
    ...(subagents
      ? { subagents: (...args: Parameters<typeof subagents>) => activity.run(agent, () => subagents(...args)) }
      : {}),
  };
}
