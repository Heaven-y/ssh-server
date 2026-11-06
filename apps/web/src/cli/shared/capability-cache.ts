import type { AgentKind } from '@agentdeck/shared/conversation';
import { queryClient } from '../../lib/query-client';
const generations = new Map<AgentKind, number>();
export const nativeCapabilitiesGeneration = (agent: AgentKind) => generations.get(agent) ?? 0;

/** 设置保存后阻止旧发现响应回填，并让下一次打开模型菜单重新读取。 */
export async function invalidateNativeCapabilities(agent: AgentKind, client = queryClient) {
  generations.set(agent, nativeCapabilitiesGeneration(agent) + 1);
  const filters = {
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] === 'agent-capabilities' && query.queryKey[2] === agent,
  };
  await client.cancelQueries(filters);
  await client.resetQueries(filters);
}
