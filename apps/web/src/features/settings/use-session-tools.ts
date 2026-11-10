import { useMutation, useQuery } from '@tanstack/react-query';
import type { AgentKind } from '@agentdeck/shared/conversation';
import type { SessionToolsStatus } from '@agentdeck/shared/settings';
import { request } from '../../lib/http';
import { queryClient } from '../../lib/query-client';

export const sessionToolsKey = (agent: AgentKind) => ['session-tools', agent] as const;
export function useSessionTools(agent: AgentKind) {
  const queryKey = sessionToolsKey(agent);
  const url = `/api/session-tools/${agent}`;
  const status = useQuery(
    {
      queryKey,
      queryFn: ({ signal }) => request<SessionToolsStatus>(url, { signal, cache: 'no-store' }),
      staleTime: 0,
    },
    queryClient,
  );
  const mutation = useMutation(
    {
      mutationFn: async (enabled: boolean) => {
        if (!status.data) throw new Error('请先读取会话读取设置');
        return request<SessionToolsStatus>(url, {
          method: 'PUT',
          body: JSON.stringify({ enabled, revision: status.data.revision }),
        });
      },
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey });
      },
    },
    queryClient,
  );
  return { status, mutation };
}
