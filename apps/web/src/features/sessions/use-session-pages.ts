import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentKind, SessionPageQuery, SessionSummary } from '@agentdeck/shared/conversation';
import { sessionsApi, sessionsKeys } from './api';
import { ApiError } from '../../lib/http';

type Options = { scope?: SessionPageQuery['scope']; search?: string; projectId?: string; enabled?: boolean };
// 重新打开页面即开始一次新读取，页面内切项目和搜索继续共享原生页。
const reader = crypto.randomUUID();
export function useSessionSearch(value = '') {
  const [search, setSearch] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(value.trim()), 200);
    return () => clearTimeout(timer);
  }, [value]);
  return search;
}
function useSource(agent: AgentKind, options: Options) {
  const scope = options.scope ?? 'active';
  const client = useQueryClient();
  const key = sessionsKeys.pages(agent, scope, options.search, options.projectId);
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      sessionsApi.page(
        { agent, scope, search: options.search, projectId: options.projectId, cursor: pageParam, reader },
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor,
    enabled: options.enabled !== false,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });
  const encodedKey = JSON.stringify(key);
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.code === 'session_page_expired')
      void client.resetQueries({ queryKey: JSON.parse(encodedKey) as readonly unknown[], exact: true });
  }, [client, encodedKey, query.error]);
  return query;
}
/** 固定三来源，项目增加不会再增加原生列表请求；正文始终按会话另读。 */
export function useSessionPages(options: Options = {}) {
  const search = useSessionSearch(options.search);
  const scoped = { ...options, search };
  const claude = useSource('claude', scoped);
  const codex = useSource('codex', scoped);
  const agy = useSource('antigravity', scoped);
  const queries = [claude, codex, agy];
  const rows = new Map<string, SessionSummary>();
  for (const query of queries)
    for (const page of query.data?.pages ?? [])
      for (const row of page.items) rows.set(`${row.agent}:${row.sessionId}`, row);
  return {
    sessions: [...rows.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    loading: options.enabled !== false && queries.some((query) => query.isPending),
    loadingMore: queries.some((query) => query.isFetchingNextPage),
    hasMore: queries.some((query) => query.hasNextPage),
    errors: queries.flatMap((query, index) =>
      query.error
        ? [{ agent: (['claude', 'codex', 'antigravity'] as const)[index]!, message: query.error.message }]
        : [],
    ),
    more: () => {
      for (const query of queries) if (query.hasNextPage && !query.isFetching) void query.fetchNextPage();
    },
    retry: () => {
      for (const query of queries) if (query.isError && !query.isFetching) void query.refetch();
    },
  };
}
