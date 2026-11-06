import { ArrowDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { ChatItem } from './chat-reducer';
import { useChat } from './chat-store';
import { finiteCount, formatDuration } from './chat-metrics';
import {
  projectTrajectory,
  trajectoryCategory,
  trajectoryStatus,
  trajectorySummary,
  type TrajectoryRow,
} from './trajectory-model';
import { PermissionCard } from './PermissionCard';
import { StatisticsLine } from './StatisticsLine';
import { buttonClass } from '../../ui/styles';

function StepIndicators({ item }: { item: Extract<TrajectoryRow, { kind: 'step' }>['item'] }) {
  const status = trajectoryStatus(item);
  const duration = item.kind === 'tool' || item.kind === 'activity' ? item.durationMs : undefined;
  return (
    <>
      <span className={`text-right ${status?.tone ?? ''}`}>{status?.label}</span>
      <span className="text-right tabular-nums text-muted-foreground">
        {finiteCount(duration) ? formatDuration(duration) : ''}
      </span>
      <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
    </>
  );
}

function StepRow({
  row,
  selected,
  inspect,
}: {
  row: Extract<TrajectoryRow, { kind: 'step' }>;
  selected: boolean;
  inspect(): void;
}) {
  const { item } = row;
  if (item.kind === 'statistics')
    return (
      <div className="border-b border-border/50 px-4 py-2">
        <StatisticsLine statistics={item} />
      </div>
    );
  return (
    <div className="border-b border-border/50">
      <button
        type="button"
        onClick={inspect}
        aria-label={`查看步骤 ${row.number}：${trajectoryCategory(item)} ${trajectorySummary(item)}`}
        aria-pressed={selected}
        className={`grid w-full grid-cols-[1.5rem_2.5rem_minmax(0,1fr)_3rem_3.5rem_0.75rem] items-center gap-2 px-4 py-3 text-left text-xs hover:bg-muted/50 ${selected ? 'bg-muted' : ''}`}
      >
        <span className="tabular-nums text-muted-foreground">{row.number}</span>
        <span className="text-muted-foreground">{trajectoryCategory(item)}</span>
        <span className="truncate leading-5" title={trajectorySummary(item)}>
          {trajectorySummary(item) || trajectoryCategory(item)}
        </span>
        <StepIndicators item={item} />
      </button>
      {item.kind === 'permission' && !item.resolved && (
        <div className="px-4 pb-3">
          <PermissionCard item={item} />
        </div>
      )}
    </div>
  );
}

function TrajectoryEntry({ row }: { row: TrajectoryRow }) {
  const selected = useChat((state) => state.inspectedItemId === (row.kind === 'step' ? row.item.id : undefined));
  const inspect = useChat((state) => state.inspectItem);
  if (row.kind === 'turn')
    return (
      <div className="border-b border-border bg-sidebar px-4 py-3">
        <div className="mb-1 text-xs font-medium text-muted-foreground">第 {row.number} 轮</div>
        {row.prompt && (
          <p className="line-clamp-2 text-[13px] leading-5" title={row.prompt}>
            {row.prompt}
          </p>
        )}
      </div>
    );
  return <StepRow row={row} selected={selected} inspect={() => inspect(row.item.id)} />;
}

/** 同一组聊天条目提供另一种投影，不维护第二份会话正文。 */
export function TrajectoryView({ items, running }: { items: ChatItem[]; running: boolean }) {
  const rows = useMemo(() => projectTrajectory(items), [items]);
  const list = useRef<VirtuosoHandle>(null);
  const atBottom = useRef(true);
  const [bottom, setBottom] = useState(true);
  useEffect(() => {
    if (atBottom.current) list.current?.autoscrollToBottom();
  }, [items]);
  if (!rows.length) return <p className="m-auto text-sm text-muted-foreground">发送消息后，执行步骤会显示在这里。</p>;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col px-4 pb-2">
      <div
        aria-hidden
        className="grid grid-cols-[1.5rem_2.5rem_minmax(0,1fr)_3rem_3.5rem_0.75rem] gap-2 border-b border-border px-4 py-2 text-[11px] text-muted-foreground"
      >
        <span>#</span>
        <span>类型</span>
        <span>执行内容</span>
        <span className="text-right">状态</span>
        <span className="text-right">耗时</span>
        <span />
      </div>
      <Virtuoso
        ref={list}
        className="min-h-0 flex-1"
        data={rows}
        computeItemKey={(_index, row) => row.id}
        defaultItemHeight={48}
        increaseViewportBy={{ top: 200, bottom: 200 }}
        initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
        followOutput={(isAtBottom) => (isAtBottom ? 'auto' : false)}
        atBottomThreshold={32}
        atBottomStateChange={(value) => {
          atBottom.current = value;
          setBottom(value);
        }}
        role="log"
        aria-label="执行轨迹"
        aria-live="polite"
        aria-busy={running}
        itemContent={(_index, row) => <TrajectoryEntry row={row} />}
      />
      {!bottom && (
        <button
          type="button"
          className={`${buttonClass('outline')} absolute bottom-4 left-1/2 -translate-x-1/2 bg-card shadow-sm`}
          onClick={() => list.current?.scrollToIndex({ index: 'LAST', align: 'end' })}
        >
          <ArrowDown aria-hidden className="size-4" />
          回到底部
        </button>
      )}
    </div>
  );
}
