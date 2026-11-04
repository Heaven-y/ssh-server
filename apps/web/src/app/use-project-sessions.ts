import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { AgentKind, SessionSummary, Workspace } from '@agentdeck/shared';
import { api, queryKeys } from '../lib/api';

/** 左栏要按项目展示分组，三条 CLI 各自一次请求；同一个 key 与对话区共享缓存。 */
const AGENTS: AgentKind[] = ['claude', 'codex', 'antigravity'];

export function useProjectSessions(projects: Workspace[] | undefined): {
  sessionsByProject: Record<string, SessionSummary[]>;
  loading: boolean;
} {
  const queries = useQueries({
    queries: (projects ?? []).flatMap((project) =>
      AGENTS.map((agent) => ({
        queryKey: queryKeys.sessions(project.id, agent),
        queryFn: ({ signal }: { signal: AbortSignal }) => api.listSessions(project.id, agent, false, signal),
        retry: false,
      })),
    ),
  });
  const sessionsByProject = useMemo(() => {
    const result: Record<string, SessionSummary[]> = {};
    for (const [index, query] of queries.entries()) {
      const project = projects?.[Math.floor(index / AGENTS.length)];
      if (!project) continue;
      result[project.id] = [...(result[project.id] ?? []), ...(query.data ?? [])];
    }
    return result;
  }, [projects, queries]);
  return { sessionsByProject, loading: queries.some((query) => query.isPending) };
}
