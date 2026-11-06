import { sessionsApi } from '../sessions/api';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { AgentKind, SessionSummary } from '@agentdeck/shared/conversation';
import type { Workspace } from '@agentdeck/shared/projects';
import { sessionHistoryFailure, sessionListQuery } from '../sessions/use-sessions';

/** 左栏要按项目展示分组，三条 CLI 各自一次请求；同一个 key 与对话区共享缓存。 */
const AGENTS: AgentKind[] = ['claude', 'codex', 'antigravity'];
export type SessionListFailure = { agent: AgentKind; message: string };

export function useProjectSessions(projects: Workspace[] | undefined): {
  sessionsByProject: Record<string, SessionSummary[]>;
  errorsByProject: Record<string, SessionListFailure[]>;
  retryProject(projectId: string): void;
  loading: boolean;
} {
  const queries = useQueries({
    queries: (projects ?? []).flatMap((project) => AGENTS.map((agent) => sessionListQuery(project.id, agent))),
  });
  const grouped = useMemo(() => {
    const result: Record<string, SessionSummary[]> = {};
    const errors: Record<string, SessionListFailure[]> = {};
    for (const [index, query] of queries.entries()) {
      const project = projects?.[Math.floor(index / AGENTS.length)];
      if (!project) continue;
      result[project.id] = [...(result[project.id] ?? []), ...(query.data ?? [])];
      if (query.error) {
        const failures = (errors[project.id] ??= []);
        failures.push({ agent: AGENTS[index % AGENTS.length]!, message: sessionHistoryFailure(query.error).message });
      }
    }
    return { sessionsByProject: result, errorsByProject: errors };
  }, [projects, queries]);
  return {
    ...grouped,
    loading: queries.some((query) => query.isPending),
    retryProject(projectId) {
      for (const [index, query] of queries.entries()) {
        if (projects?.[Math.floor(index / AGENTS.length)]?.id === projectId && query.isError && !query.isFetching)
          void query.refetch();
      }
    },
  };
}

/** 其他目录需要显式展开后发现，零项目也可使用；只返回摘要，不读取正文。 */
export function useOtherSessions(enabled: boolean) {
  const queries = useQueries({
    queries: AGENTS.map((agent) => ({
      queryKey: ['sessions', 'unassigned', agent],
      queryFn: ({ signal }: { signal: AbortSignal }) => sessionsApi.orphanSessions(agent, signal),
      enabled,
      retry: false,
    })),
  });
  return {
    sessions: queries.flatMap((query) => query.data ?? []),
    loading: enabled && queries.some((query) => query.isPending),
    error: queries.find((query) => query.error)?.error?.message,
  };
}
