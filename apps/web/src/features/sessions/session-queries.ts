import type { AgentKind } from '@agentdeck/shared/conversation';
import { queryClient } from '../../lib/query-client';
import type { InfiniteData, QueryClient, QueryFilters } from '@tanstack/react-query';
import type { SessionPage } from '@agentdeck/shared/conversation';

export async function invalidateSessionPages(client: QueryClient, filters: QueryFilters) {
  await client.cancelQueries(filters);
  for (const query of client.getQueryCache().findAll(filters)) {
    if (query.queryKey[1] !== 'pages') continue;
    client.setQueryData<InfiniteData<SessionPage>>(query.queryKey, (data) =>
      data ? { pages: data.pages.slice(0, 1), pageParams: [undefined] } : data,
    );
  }
  return client.invalidateQueries(filters);
}

/** 原生操作完成后更新同来源摘要；先取消在途旧读取，首次加载也能取得新结果。 */
export async function refreshSessionLists(agent: AgentKind): Promise<void> {
  const affectedLists = {
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] === 'sessions' && query.queryKey[2] === agent,
  };
  await invalidateSessionPages(queryClient, affectedLists);
}
