import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '../../lib/api';
import { useChat } from './chat-store';

/** 只缓存公开能力元数据；搜索在本地完成，不为每次输入启动原生运行时。 */
export function useAgentCapabilities(enabled: boolean) {
  const workspaceId = useChat((state) => state.workspaceId);
  const agent = useChat((state) => state.agent);
  return useQuery({
    queryKey: queryKeys.agentCapabilities(workspaceId ?? '', agent),
    queryFn: ({ signal }) => api.agentCapabilities(workspaceId ?? '', agent, signal),
    enabled: enabled && !!workspaceId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
