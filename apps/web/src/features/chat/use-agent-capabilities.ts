import { chatApi, chatKeys } from './api';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useChat } from './chat-store';
import type { AgentCapabilities, AgentKind } from '@agentdeck/shared/conversation';
import { nativeCapabilitiesGeneration } from '../../cli/shared/capability-cache';
import { currentCapabilityError } from './capability-feedback';

type CapabilityScope = { workspaceId: string; agent: AgentKind; sessionId?: string };
type CapabilityRefresh = CapabilityScope & { generation: number };
// 重建输入区或切回会话不会重复执行失败的自动发现；配置代次改变后允许重新读取。
const autoAttempts = new WeakMap<QueryClient, Set<string>>();
function discoveryAttempts(client: QueryClient) {
  let attempts = autoAttempts.get(client);
  if (!attempts) {
    attempts = new Set();
    autoAttempts.set(client, attempts);
  }
  return attempts;
}
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
function wasDiscovered(data: AgentCapabilities | undefined, commands: boolean) {
  return commands ? (data?.commandsDiscovered ?? data?.discovered) : data?.discovered;
}

/** 模型复用磁盘缓存；显式打开技能时补取本进程的命令目录，补全只读取已有结果。 */
export function useAgentCapabilities(enabled: boolean, discoverOnOpen = false, commands = false) {
  const client = useQueryClient();
  const workspaceId = useChat((state) => state.workspaceId);
  const agent = useChat((state) => state.agent);
  const sessionId = useChat((state) => state.sessionId ?? undefined);
  const key = chatKeys.agentCapabilities(workspaceId ?? '', agent, sessionId);
  const generation = nativeCapabilitiesGeneration(agent);
  const attempted = discoveryAttempts(client);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => chatApi.agentCapabilities(workspaceId ?? '', agent, signal, sessionId),
    enabled: enabled && !!workspaceId,
    staleTime: Infinity,
    // 非活跃会话只暂存十分钟；再次打开先读取服务端/磁盘缓存，不重新发现模型。
    gcTime: 10 * 60 * 1000,
    retryOnMount: false,
    retry: false,
  });
  const refresh = useMutation({
    mutationKey: key,
    mutationFn: async (target: CapabilityRefresh) => {
      await client.cancelQueries({
        queryKey: chatKeys.agentCapabilities(target.workspaceId, target.agent, target.sessionId),
      });
      return chatApi.refreshAgentCapabilities(target.workspaceId, target.agent, target.sessionId);
    },
    onSuccess: (data, target) => {
      if (target.generation !== nativeCapabilitiesGeneration(target.agent)) return;
      client.setQueryData(chatKeys.agentCapabilities(target.workspaceId, target.agent, target.sessionId), data);
      // 成功后由缓存决定是否发现；缓存回收后应允许重新读取，失败尝试仍不循环重试。
      for (const commands of [false, true])
        attempted.delete(
          JSON.stringify([
            chatKeys.agentCapabilities(target.workspaceId, target.agent, target.sessionId),
            target.generation,
            commands,
          ]),
        );
    },
    retry: false,
  });
  const targetKey = JSON.stringify([key, generation, commands]);
  const discovered = wasDiscovered(query.data, commands);
  const shouldDiscover = mayDiscover(enabled, discoverOnOpen, workspaceId, discovered);
  const mutate = refresh.mutate;
  useEffect(() => {
    if (!shouldDiscover || !workspaceId || attempted.has(targetKey)) return;
    attempted.add(targetKey);
    mutate({ workspaceId, agent, sessionId, generation });
  }, [shouldDiscover, targetKey, workspaceId, agent, sessionId, generation, mutate, attempted]);
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
