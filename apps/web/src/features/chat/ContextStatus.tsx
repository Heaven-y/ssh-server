import { Popover, PopoverDisclosure, usePopoverStore } from '@ariakit/react';
import { ChevronDown } from 'lucide-react';
import type { CompactionState, ContextUsage } from '@agentdeck/shared/conversation';
import { useChat } from './chat-store';

const numberFormat = new Intl.NumberFormat('zh-CN');
const tokens = (value: number) => numberFormat.format(value);
const statusLabels: Record<CompactionState['status'], string> = {
  running: '正在压缩',
  completed: '压缩已完成',
  failed: '压缩失败',
  cancelled: '压缩已中断',
};
function compactionTitle(state: CompactionState, incomplete: boolean): string {
  const title = incomplete ? '压缩结果未确认' : statusLabels[state.status];
  if (!state.trigger) return title;
  return `${title} · ${state.trigger === 'manual' ? '手动' : '自动'}`;
}

export function CompactionStatus({ state, incomplete = false }: { state: CompactionState; incomplete?: boolean }) {
  const warning = incomplete || ['failed', 'cancelled'].includes(state.status);
  return (
    <div className={`space-y-1 text-xs leading-6 ${warning ? 'text-warning' : 'text-muted-foreground'}`}>
      <p>{compactionTitle(state, incomplete)}</p>
      {(state.beforeTokens !== undefined || state.afterTokens !== undefined) && (
        <p>
          压缩前 {state.beforeTokens === undefined ? '—' : tokens(state.beforeTokens)} tokens · 压缩后{' '}
          {state.afterTokens === undefined ? '—' : tokens(state.afterTokens)} tokens
        </p>
      )}
      {state.message && <p className="break-words">{state.message}</p>}
    </div>
  );
}

function usageSource(usage: ContextUsage): string {
  const labels = {
    claude_estimate: 'Claude 原生估计',
    codex_native: 'Codex 原生统计/估算',
    antigravity_estimate: 'Antigravity 原生估计',
  };
  return labels[usage.source];
}

export function contextPercentage(usage: ContextUsage): number | undefined {
  if (Number.isFinite(usage.percentage) && usage.percentage! >= 0) return usage.percentage;
  if (usage.windowTokens === undefined || !Number.isFinite(usage.windowTokens) || usage.windowTokens <= 0) return;
  return Number.isFinite(usage.usedTokens) && usage.usedTokens >= 0
    ? (usage.usedTokens / usage.windowTokens) * 100
    : undefined;
}

function ContextMeter({ percentage }: { percentage: number }) {
  const display = Math.round(percentage * 10) / 10;
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`上下文占用 ${display}%`}>
      <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0 -rotate-90" fill="none" strokeWidth="2.5">
        <circle cx="10" cy="10" r="7" stroke="currentColor" className="text-border" />
        <circle
          cx="10"
          cy="10"
          r="7"
          pathLength="100"
          stroke="currentColor"
          strokeDasharray={`${Math.min(percentage, 100)} 100`}
          strokeLinecap="round"
          opacity={percentage > 0 ? 1 : 0}
          className={percentage >= 90 ? 'text-warning' : 'text-muted-foreground'}
        />
      </svg>
      <span className="text-xs tabular-nums">{display}%</span>
    </span>
  );
}
/** 用量与窗口分别保留；缺失字段用横线表示，不能用压缩事件代替。 */
export function usageSummary(usage: ContextUsage): string {
  const used = usage.usedTokens === undefined ? undefined : tokens(usage.usedTokens);
  const window = usage.windowTokens === undefined ? undefined : tokens(usage.windowTokens);
  return `${used ?? '—'} / ${window ?? '—'}`;
}
export function UsageDetails({ usage }: { usage: ContextUsage }) {
  const percentage = contextPercentage(usage);
  return (
    <>
      <p>{usageSource(usage)}</p>
      <p>
        用量 {usage.usedTokens === undefined ? '—' : `${tokens(usage.usedTokens)} tokens`}
        {usage.windowTokens !== undefined && ` / 窗口 ${tokens(usage.windowTokens)} tokens`}
        {percentage !== undefined && ` · ${Math.round(percentage * 10) / 10}%`}
      </p>
      {usage.model && <p className="break-all">模型：{usage.model}</p>}
    </>
  );
}

function usageTitle(usage: ContextUsage | null | undefined, summary: string | undefined): string | undefined {
  if (!usage) return '此会话尚无可用的上下文用量与窗口报告';
  return summary ? `${usageSource(usage)} · ${summary} tokens` : usageSource(usage);
}

function ContextLabel({
  usage,
  compaction,
  incomplete,
}: {
  usage?: ContextUsage | null;
  compaction?: CompactionState;
  incomplete: boolean;
}) {
  const summary = usage ? usageSummary(usage) : undefined;
  const percentage = usage ? contextPercentage(usage) : undefined;
  return (
    <>
      <span className="whitespace-nowrap">上下文 {summary ?? '—'}</span>
      {percentage !== undefined && <ContextMeter percentage={percentage} />}
      {compaction?.status === 'running' && !incomplete && <span>正在压缩</span>}
      <ChevronDown aria-hidden className="size-3.5 shrink-0" />
    </>
  );
}
/**
 * 位于输入框下方，报告缺失时用横线保留位置；过去的压缩结果只留在详情。
 */
export function ContextStatus() {
  const popover = usePopoverStore({ placement: 'top-end' });
  const usage = useChat((state) => state.contextUsage);
  const compaction = useChat((state) => state.compaction);
  const running = useChat((state) => state.running);
  const incomplete = compaction?.status === 'running' && !running;
  const summary = usage ? usageSummary(usage) : undefined;
  return (
    <>
      <PopoverDisclosure
        store={popover}
        render={<button type="button" />}
        aria-label="上下文用量"
        title={usageTitle(usage, summary)}
        className="composer-statistic inline-flex min-h-6 min-w-0 max-w-full flex-wrap items-center gap-1 rounded-md px-1 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      >
        <ContextLabel usage={usage} compaction={compaction} incomplete={incomplete} />
      </PopoverDisclosure>
      <Popover
        store={popover}
        portal
        unmountOnHide
        gutter={8}
        aria-label="上下文用量详情"
        className="z-50 max-h-[min(360px,var(--popover-available-height))] w-80 max-w-[calc(100vw-32px)] space-y-2 overflow-y-auto rounded-2xl border border-border bg-card p-3 text-[13px] leading-6 text-muted-foreground shadow-lg"
      >
        {usage ? <UsageDetails usage={usage} /> : <p>此会话尚无可用的上下文用量与窗口报告。</p>}
        {compaction && <CompactionStatus state={compaction} incomplete={incomplete} />}
      </Popover>
    </>
  );
}
