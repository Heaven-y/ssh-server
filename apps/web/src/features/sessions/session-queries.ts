import type { AgentKind } from '@agentdeck/shared/conversation';
import { queryClient } from '../../lib/query-client';

/** 原生操作完成后更新同来源摘要；先取消在途旧读取，首次加载也能取得新结果。 */
export async function refreshSessionLists(agent: AgentKind): Promise<void> {
  const affectedLists = {
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] === 'sessions' && query.queryKey[2] === agent,
  };
  await queryClient.cancelQueries(affectedLists);
  void queryClient.invalidateQueries(affectedLists);
}
