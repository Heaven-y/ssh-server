import { Popover, PopoverDisclosure, usePopoverStore } from '@ariakit/react';
import { ChevronDown } from 'lucide-react';
import type { CompactionState, ContextUsage } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
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
  return usage.source === 'claude_estimate' ? 'Claude 原生估计' : 'Codex 原生统计/估算';
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
  const percentage = usage.source === 'claude_estimate' ? usage.percentage : undefined;
  return (
    <>
      <p>{usageSource(usage)}</p>
      <p>
        用量 {usage.usedTokens === undefined ? '—' : `${tokens(usage.usedTokens)} tokens`}
        {usage.windowTokens !== undefined && ` / 窗口 ${tokens(usage.windowTokens)} tokens`}
        {percentage !== undefined && ` · ${percentage}%`}
      </p>
      {usage.model && <p className="break-all">模型：{usage.model}</p>}
    </>
  );
}

function usageTitle(usage: ContextUsage | null | undefined, summary: string): string | undefined {
  if (!usage) return undefined;
  return summary ? `${usageSource(usage)} · ${summary} tokens` : usageSource(usage);
}
/**
 * 与模型、强度共用输入控制行；有原生报告或压缩事件才显示，无数据整体隐藏。
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
        className={`${buttonClass('ghost')} min-w-0 max-w-full flex-wrap gap-1 rounded-full px-2 text-xs text-muted-foreground`}
      >
        {summary && <span className="whitespace-nowrap">上下文 {summary}</span>}
        {compaction && <span>{compactionTitle(compaction, incomplete)}</span>}
        <ChevronDown aria-hidden className="size-3.5 shrink-0" />
      </PopoverDisclosure>
      <Popover
        store={popover}
        portal
        unmountOnHide
        gutter={8}
        aria-label="上下文用量详情"
        className="z-50 max-h-[min(360px,var(--popover-available-height))] w-80 max-w-[calc(100vw-32px)] space-y-2 overflow-y-auto rounded-xl border border-border-strong bg-card p-3 text-xs leading-6 text-muted-foreground shadow-xl"
      >
        {usage ? <UsageDetails usage={usage} /> : <p>尚无上下文用量报告</p>}
        {compaction && <CompactionStatus state={compaction} incomplete={incomplete} />}
      </Popover>
    </>
  );
}
