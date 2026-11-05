import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, queryKeys } from '../../lib/api';
import { useChat } from './chat-store';
import type { AgentKind } from '@agentdeck/shared';
import { nativeCapabilitiesGeneration } from '../settings/model-settings-api';
import { currentCapabilityError } from './capability-feedback';

type CapabilityScope = { workspaceId: string; agent: AgentKind; sessionId?: string };
type CapabilityRefresh = CapabilityScope & { generation: number };
function sameTarget(current: CapabilityScope, previous?: CapabilityScope) {
  return (
    !!previous &&
    previous.workspaceId === current.workspaceId &&
    previous.agent === current.agent &&
    previous.sessionId === current.sessionId
  );
}
function mayDiscover(enabled: boolean, automatic: boolean, workspaceId: string | undefined, discovered?: boolean) {
  return enabled && automatic && !!workspaceId && discovered === false;
}
function isCurrentRefresh(scope: CapabilityScope, generation: number, previous?: CapabilityRefresh) {
  return previous?.generation === generation && sameTarget(scope, previous);
}

/** 模型菜单首次打开可发现能力；技能和补全入口仍只读缓存。 */
export function useAgentCapabilities(enabled: boolean, discoverOnOpen = false) {
  const client = useQueryClient();
  const workspaceId = useChat((state) => state.workspaceId);
  const agent = useChat((state) => state.agent);
  const sessionId = useChat((state) => state.sessionId ?? undefined);
  const key = queryKeys.agentCapabilities(workspaceId ?? '', agent, sessionId);
  const generation = nativeCapabilitiesGeneration(agent);
  const attempted = useRef(new Set<string>());
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.agentCapabilities(workspaceId ?? '', agent, signal, sessionId),
    enabled: enabled && !!workspaceId,
    staleTime: Infinity,
    retry: false,
  });
  const refresh = useMutation({
    mutationKey: key,
    mutationFn: async (target: CapabilityRefresh) => {
      await client.cancelQueries({
        queryKey: queryKeys.agentCapabilities(target.workspaceId, target.agent, target.sessionId),
      });
      return api.refreshAgentCapabilities(target.workspaceId, target.agent, target.sessionId);
    },
    onSuccess: (data, target) => {
      if (target.generation !== nativeCapabilitiesGeneration(target.agent)) return;
      client.setQueryData(queryKeys.agentCapabilities(target.workspaceId, target.agent, target.sessionId), data);
    },
    retry: false,
  });
  const targetKey = JSON.stringify([key, generation]);
  const shouldDiscover = mayDiscover(enabled, discoverOnOpen, workspaceId, query.data?.discovered);
  const mutate = refresh.mutate;
  useEffect(() => {
    if (!shouldDiscover || !workspaceId || attempted.current.has(targetKey)) return;
    attempted.current.add(targetKey);
    mutate({ workspaceId, agent, sessionId, generation });
  }, [shouldDiscover, targetKey, workspaceId, agent, sessionId, generation, mutate]);
  const currentRefresh = isCurrentRefresh(
    { workspaceId: workspaceId ?? '', agent, sessionId },
    generation,
    refresh.variables,
  );
  return {
    ...query,
    error: currentCapabilityError(currentRefresh, refresh, query.error),
    isFetching: query.isFetching || (currentRefresh && refresh.isPending),
    isError: query.isError || (currentRefresh && refresh.isError),
    refresh: () => {
      if (workspaceId && !(currentRefresh && refresh.isPending))
        refresh.mutate({ workspaceId, agent, sessionId, generation: nativeCapabilitiesGeneration(agent) });
    },
  };
}
