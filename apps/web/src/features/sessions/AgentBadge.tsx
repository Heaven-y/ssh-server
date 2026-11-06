import type { AgentKind } from '@agentdeck/shared/conversation';
import { AGENT_LABELS } from '../../cli/shared/labels';

/**
 * CLI 徽标：一个字母足够区分三个 CLI，左栏分组与会话头共用同一形态，
 * 完整的 CLI 名由相邻文字或 title 给出，徽标本身对辅助技术隐藏。
 */
export function AgentBadge({ agent, className = 'size-5 text-[10px]' }: { agent: AgentKind; className?: string }) {
  return (
    <span
      aria-hidden
      title={AGENT_LABELS[agent]}
      className={`flex shrink-0 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground ${className}`}
    >
      {AGENT_LABELS[agent].slice(0, 1)}
    </span>
  );
}
