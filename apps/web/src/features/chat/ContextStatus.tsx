import { Popover, PopoverDisclosure, usePopoverStore } from '@ariakit/react';
import { ChevronDown } from 'lucide-react';
import type { CompactionState, ContextUsage } from '@agentdeck/shared';
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
      <span aria-hidden className="h-1 w-10 overflow-hidden rounded-full bg-border">
        <span
          className={`block h-full rounded-full ${percentage >= 90 ? 'bg-warning' : 'bg-muted-foreground'}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </span>
      <span className="text-xs tabular-nums">{display}%</span>
    </span>
  );
}
/** 摘要只显示有数据的字段，缺窗口时只显示已用量。 */
function usageSummary(usage: ContextUsage): string {
  const used = usage.usedTokens === undefined ? undefined : tokens(usage.usedTokens);
  const window = usage.windowTokens === undefined ? undefined : tokens(usage.windowTokens);
  if (used === undefined && window === undefined) return '';
  if (used === undefined) return `${window} / 窗口`;
  return window === undefined ? used : `${used} / ${window}`;
}
function UsageDetails({ usage }: { usage: ContextUsage }) {
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
  if (!usage) return undefined;
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
      {summary && <span className="whitespace-nowrap">上下文 {summary}</span>}
      {percentage !== undefined && <ContextMeter percentage={percentage} />}
      {compaction && <span>{compactionTitle(compaction, incomplete)}</span>}
      <ChevronDown aria-hidden className="size-3.5 shrink-0" />
    </>
  );
}
/**
 * 位于输入框下方；有原生报告或压缩事件才显示，无数据整体隐藏。
 * 只显示原生数据，详情不占常驻高度。
 */
export function ContextStatus() {
  const popover = usePopoverStore({ placement: 'top-end' });
  const usage = useChat((state) => state.contextUsage);
  const compaction = useChat((state) => state.compaction);
  const running = useChat((state) => state.running);
  const incomplete = compaction?.status === 'running' && !running;
  if (!usage && !compaction) return null;
  const summary = usage ? usageSummary(usage) : undefined;
  return (
    <>
      <PopoverDisclosure
        store={popover}
        render={<button type="button" />}
        aria-label="上下文用量"
        title={usageTitle(usage, summary)}
        className="inline-flex min-h-6 min-w-0 max-w-full flex-wrap items-center gap-1 rounded-md px-1 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
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
        {usage && <UsageDetails usage={usage} />}
        {compaction && <CompactionStatus state={compaction} incomplete={incomplete} />}
      </Popover>
    </>
  );
}
