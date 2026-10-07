import { useQuery } from '@tanstack/react-query';
import type { AgentKind, EnvironmentReport } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';

/** 复用后端启动时的一次报告；设置打开与窗口聚焦都不触发重新探测。 */
export function useEnvironment() {
  return useQuery({
    queryKey: queryKeys.environment,
    queryFn: ({ signal }) => api.readEnvironment(signal),
    staleTime: Infinity,
    retry: false,
  });
}
export function agentUnavailable(report: EnvironmentReport | undefined, agent: AgentKind) {
  const name = agent === 'claude' ? 'Claude Code' : 'Codex';
  return report?.tools.find((tool) => tool.name === name)?.available === false;
}
