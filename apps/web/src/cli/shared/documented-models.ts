import type { AgentKind } from '@agentdeck/shared/conversation';
import { stripContext } from './model-identity';
export const standardEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];
/** 官方文档核对范围见 docs/engineering/model-capabilities.md，未确认型号不套家族规则。 */
const documentedModels: Array<{ pattern: RegExp; efforts: string[]; agents: AgentKind[] }> = [
  { pattern: /^gpt-(6-astra|6\.1-sol)$/, efforts: standardEfforts, agents: ['codex'] },
  {
    pattern: /^claude-(?:opus-(?:5-5|5|4-8|4-7)|sonnet-(?:5-5|5)|haiku-5-5|fable-(?:5-1|5))$/,
    efforts: standardEfforts,
    agents: ['claude', 'codex'],
  },
  { pattern: /^claude-(opus|sonnet)-4-6$/, efforts: ['low', 'medium', 'high', 'max'], agents: ['claude', 'codex'] },
  {
    pattern: /^deepseek-(?:flash|v4-flash|v4\.1-flash|v4-pro)$/,
    efforts: ['low', 'high', 'max'],
    agents: ['claude', 'codex'],
  },
  {
    pattern: /^kimi-(?:k3|k3\.1-pro|k3\.1-pro-highspeed)$/,
    efforts: ['low', 'high', 'max'],
    agents: ['claude', 'codex'],
  },
  { pattern: /^glm-5\.3$/, efforts: ['low', 'high', 'max'], agents: ['codex'] },
  { pattern: /^glm-5\.2$/, efforts: ['high', 'max'], agents: ['codex'] },
  {
    pattern: /^qwen3\.8-(?:max(?:-0902)?|flash|2\.4t-a95b|27b)$/,
    efforts: ['none', 'low', 'medium', 'xhigh'],
    agents: ['codex'],
  },
];
export function documentedEfforts(agent: AgentKind, id: string): string[] {
  const model = stripContext(id).toLowerCase();
  return documentedModels.find((entry) => entry.agents.includes(agent) && entry.pattern.test(model))?.efforts ?? [];
}
