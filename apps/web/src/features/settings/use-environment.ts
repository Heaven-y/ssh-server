import { useQuery } from '@tanstack/react-query';
import type { AgentKind, EnvironmentReport } from '@agentdeck/shared';
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
/** 环境报告用界面名称，AgentKind 用小写 id，两边只在这一次转换。 */
const AGENT_TOOLS: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
};
export function agentUnavailable(report: EnvironmentReport | undefined, agent: AgentKind) {
  return report?.tools.find((tool) => tool.name === AGENT_TOOLS[agent])?.available === false;
}
