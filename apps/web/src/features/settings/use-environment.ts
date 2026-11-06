import { settingsApi, settingsKeys } from './api';
import { useQuery } from '@tanstack/react-query';
import type { AgentKind } from '@agentdeck/shared/conversation';
import type { EnvironmentReport, EnvironmentTool } from '@agentdeck/shared/settings';

/** 复用后端启动时的一次报告；设置打开与窗口聚焦都不触发重新探测。 */
export function useEnvironment() {
  return useQuery({
    queryKey: settingsKeys.environment,
    queryFn: ({ signal }) => settingsApi.readEnvironment(signal),
    staleTime: Infinity,
    retry: false,
  });
}
/** 环境报告用界面名称，AgentKind 用小写 id，两边只在这一次转换。 */
const AGENT_TOOLS: Record<AgentKind, EnvironmentTool['name']> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
};
export function agentTool(report: EnvironmentReport | undefined, agent: AgentKind) {
  return report?.tools.find((tool) => tool.name === AGENT_TOOLS[agent]);
}
export function agentUnavailable(report: EnvironmentReport | undefined, agent: AgentKind) {
  return agentTool(report, agent)?.available === false;
}
/** 会话头只显示探测到的真实版本；没有探测结果时不编造。 */
export function agentVersion(report: EnvironmentReport | undefined, agent: AgentKind): string | undefined {
  return agentTool(report, agent)?.version ?? undefined;
}
