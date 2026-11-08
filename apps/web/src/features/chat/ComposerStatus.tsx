import { Popover, PopoverDisclosure, usePopoverStore } from '@ariakit/react';
import { ChevronDown, Clock3, Gauge } from 'lucide-react';
import type { ChatItem } from './chat-reducer';
import { averageTokenRate, finiteCount, formatDuration, tokenFields } from './chat-metrics';
import { ContextStatus } from './ContextStatus';
import { StatisticsLine } from './StatisticsLine';
import { useChat } from './chat-store';

type StatisticsItem = Extract<ChatItem, { kind: 'statistics' }>;

/** 底部只代表最新用户轮次；正在运行或本轮无报告时不借用上一轮速度。 */
export function latestComposerStatistics(items: ChatItem[], running: boolean): StatisticsItem | undefined {
  if (running) return;
  const start = items.findLastIndex((item) => item.kind === 'user');
  const current = items.slice(start + 1).filter((item): item is StatisticsItem => item.kind === 'statistics');
  return current.findLast((item) => item.scope === 'turn') ?? current.at(-1);
}

function statisticsHint(item: StatisticsItem | undefined, running: boolean): string {
  if (running) return '本轮完成后显示平均速度';
  if (!item) return '此会话未提供本轮输出 token 与耗时';
  if (item.isError) return '本轮未成功完成，不计算平均速度';
  if (averageTokenRate(item) !== undefined)
    return item.scope === 'turn' ? '回合输出 token ÷ 总耗时，包含工具与等待时间' : '模型步骤输出 token ÷ 步骤耗时';
  return '缺少同一范围的有效输出 token 或耗时，无法计算速度';
}

function TurnStatistics({ item, running }: { item?: StatisticsItem; running: boolean }) {
  const popover = usePopoverStore({ placement: 'top-end' });
  const rate = item && averageTokenRate(item);
  const duration = finiteCount(item?.durationMs) ? item.durationMs : undefined;
  const hint = statisticsHint(item, running);
  const hasDetails = item && (duration !== undefined || tokenFields(item.usage).length > 0);
  return (
    <>
      <PopoverDisclosure
        store={popover}
        render={<button type="button" />}
        aria-label="本轮统计详情"
        className="composer-statistic inline-flex min-h-6 max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        title={hint}
      >
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Gauge aria-hidden className="size-3" />
          {rate === undefined ? '—' : rate.toFixed(1)} tok/s
        </span>
        {duration !== undefined && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Clock3 aria-hidden className="size-3" /> {formatDuration(duration)}
          </span>
        )}
        <ChevronDown aria-hidden className="size-3" />
      </PopoverDisclosure>
      <Popover
        store={popover}
        portal
        unmountOnHide
        gutter={8}
        aria-label="本轮统计详情"
        className="z-50 max-w-[calc(100vw-32px)] rounded-xl border border-border bg-card px-4 py-3 shadow-lg"
      >
        {hasDetails ? <StatisticsLine statistics={item} /> : <p className="text-xs text-muted-foreground">{hint}</p>}
      </Popover>
    </>
  );
}

/** 常驻摘要放在输入框外；历史的完整统计仍在轨迹视图中查看。 */
export function ComposerStatus() {
  const items = useChat((state) => state.items);
  const running = useChat((state) => state.running || !!state.pendingClientTurnId);
  const latest = latestComposerStatistics(items, running);
  return (
    <div role="group" aria-label="会话统计" className="composer-status">
      <TurnStatistics key={latest?.id ?? 'pending'} item={latest} running={running} />
      <ContextStatus />
    </div>
  );
}
