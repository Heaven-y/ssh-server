import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../../lib/api';
import { useChat } from './chat-store';

/** GET 只读后端缓存；只有显式 refresh 才启动原生能力检查。 */
export function useAgentCapabilities(enabled: boolean) {
  const client = useQueryClient();
  const workspaceId = useChat((state) => state.workspaceId);
  const agent = useChat((state) => state.agent);
  const key = queryKeys.agentCapabilities(workspaceId ?? '', agent);
  const query = useQuery({
    queryKey: queryKeys.agentCapabilities(workspaceId ?? '', agent),
    queryFn: ({ signal }) => api.agentCapabilities(workspaceId ?? '', agent, signal),
    enabled: enabled && !!workspaceId,
    staleTime: Infinity,
    retry: false,
  });
  const refresh = useMutation({
    mutationKey: key,
    mutationFn: async (target: { workspaceId: string; agent: typeof agent }) => {
      await client.cancelQueries({ queryKey: queryKeys.agentCapabilities(target.workspaceId, target.agent) });
      return api.refreshAgentCapabilities(target.workspaceId, target.agent);
    },
    onSuccess: (data, target) =>
      client.setQueryData(queryKeys.agentCapabilities(target.workspaceId, target.agent), data),
    retry: false,
  });
  return {
    ...query,
    isFetching: query.isFetching || refresh.isPending,
    isError: query.isError || refresh.isError,
    refresh: () => {
      if (workspaceId && !refresh.isPending) refresh.mutate({ workspaceId, agent });
    },
  };
}
