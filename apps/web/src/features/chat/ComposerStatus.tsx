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

function TurnStatistics({ item }: { item: StatisticsItem }) {
  const popover = usePopoverStore({ placement: 'top-end' });
  const rate = averageTokenRate(item);
  const duration = finiteCount(item.durationMs) ? item.durationMs : undefined;
  if (duration === undefined && !tokenFields(item.usage).length) return null;
  return (
    <>
      <PopoverDisclosure
        store={popover}
        render={<button type="button" />}
        aria-label="本轮统计详情"
        className="inline-flex min-h-6 max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      >
        {duration !== undefined && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Clock3 aria-hidden className="size-3" /> {formatDuration(duration)}
          </span>
        )}
        {rate !== undefined ? (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Gauge aria-hidden className="size-3" />
            {item.scope === 'turn' ? '回合' : '步骤'}平均 {rate.toFixed(1)} tok/s
          </span>
        ) : (
          <span>用量详情</span>
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
        <StatisticsLine statistics={item} />
      </Popover>
    </>
  );
}

/** 常驻摘要放在输入框外；历史的完整统计仍在轨迹视图中查看。 */
export function ComposerStatus() {
  const items = useChat((state) => state.items);
  const running = useChat((state) => state.running || !!state.pendingClientTurnId);
  const context = useChat((state) => state.contextUsage);
  const compaction = useChat((state) => state.compaction);
  const latest = latestComposerStatistics(items, running);
  if (!context && !compaction && !latest) return null;
  return (
    <div role="group" aria-label="会话统计" className="composer-status">
      <ContextStatus />
      {latest && <TurnStatistics key={latest.id} item={latest} />}
    </div>
  );
}
