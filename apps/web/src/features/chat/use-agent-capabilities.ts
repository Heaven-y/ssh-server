import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../../lib/api';
import { useChat } from './chat-store';

/** GET 只读后端缓存；只有显式 refresh 才启动原生能力检查。 */
export function useAgentCapabilities(enabled: boolean) {
  const client = useQueryClient();
  const workspaceId = useChat((state) => state.workspaceId);
  const agent = useChat((state) => state.agent);
  const sessionId = useChat((state) => state.sessionId ?? undefined);
  const key = queryKeys.agentCapabilities(workspaceId ?? '', agent, sessionId);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.agentCapabilities(workspaceId ?? '', agent, signal, sessionId),
    enabled: enabled && !!workspaceId,
    staleTime: Infinity,
    retry: false,
  });
  const refresh = useMutation({
    mutationKey: key,
    mutationFn: async (target: { workspaceId: string; agent: typeof agent; sessionId?: string }) => {
      await client.cancelQueries({
        queryKey: queryKeys.agentCapabilities(target.workspaceId, target.agent, target.sessionId),
      });
      return api.refreshAgentCapabilities(target.workspaceId, target.agent, target.sessionId);
    },
    onSuccess: (data, target) =>
      client.setQueryData(queryKeys.agentCapabilities(target.workspaceId, target.agent, target.sessionId), data),
    retry: false,
  });
  return {
    ...query,
    isFetching: query.isFetching || refresh.isPending,
    isError: query.isError || refresh.isError,
    refresh: () => {
      if (workspaceId && !refresh.isPending) refresh.mutate({ workspaceId, agent, sessionId });
    },
  };
}
