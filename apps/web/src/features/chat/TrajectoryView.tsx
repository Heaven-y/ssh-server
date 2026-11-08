import { ArrowDown, Bot, ChevronRight, Layers, User, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { ChatItem } from './chat-reducer';
import { useChat } from './chat-store';
import { finiteCount, formatDuration } from './chat-metrics';
import {
  projectTrajectory,
  filterTrajectory,
  trajectoryRole,
  trajectoryRoles,
  type TrajectoryFilter,
  trajectoryCategory,
  trajectoryStatus,
  trajectorySummary,
  type TrajectoryRow,
} from './trajectory-model';
import { PermissionCard } from './PermissionCard';
import { StatisticsLine } from './StatisticsLine';
import { buttonClass } from '../../ui/styles';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { TrajectoryContext } from './TrajectoryContext';

const roleIcons = { context: Layers, user: User, tool: Wrench, assistant: Bot };
const filters = [
  { value: 'all', label: '全部' },
  ...Object.entries(trajectoryRoles).map(([value, label]) => ({ value: value as TrajectoryFilter, label })),
] as const;
const initialPosition = (running: boolean, filter: TrajectoryFilter) =>
  running && filter === 'all'
    ? { index: 'LAST' as const, align: 'end' as const }
    : { index: 0, align: 'start' as const };

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
  const role = trajectoryRole(item);
  const Icon = roleIcons[role];
  if (item.kind === 'statistics')
    return (
      <div className="border-b border-border/50 px-4 py-2">
        <StatisticsLine statistics={item} />
      </div>
    );
  return (
    <div className="trajectory-entry" data-role={role}>
      <button
        type="button"
        onClick={inspect}
        aria-label={`查看步骤 ${row.number}：${trajectoryCategory(item)} ${trajectorySummary(item)}`}
        aria-pressed={selected}
        className="trajectory-step"
      >
        <span className="trajectory-icon">
          <Icon aria-hidden className="size-3.5" />
        </span>
        <span className="trajectory-content">
          <span className="trajectory-label">
            <b>{trajectoryRoles[role]}</b>
            <span>{trajectoryCategory(item)}</span>
            <span className="ml-auto tabular-nums">{row.number}</span>
          </span>
          <span className="trajectory-summary" title={trajectorySummary(item)}>
            {trajectorySummary(item) || trajectoryCategory(item)}
          </span>
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

function TrajectoryEntry({ row, filter }: { row: TrajectoryRow; filter: TrajectoryFilter }) {
  const selected = useChat((state) => state.inspectedItemId === (row.kind === 'step' ? row.item.id : row.user?.id));
  const inspect = useChat((state) => state.inspectItem);
  if (row.kind === 'turn')
    return (
      <div className="trajectory-turn">
        <div className="trajectory-turn-label">第 {row.number} 轮</div>
        {row.user && (filter === 'all' || filter === 'user') && (
          <button
            type="button"
            className="trajectory-user"
            aria-label={`查看用户消息：${row.prompt}`}
            aria-pressed={selected}
            onClick={() => inspect(row.user!.id)}
          >
            <User aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0">
              <b className="block text-xs font-medium">用户</b>
              <span className="mt-1 block line-clamp-2 text-[13px] leading-6">{row.prompt}</span>
            </span>
            <ChevronRight aria-hidden className="ml-auto size-3.5 shrink-0" />
          </button>
        )}
      </div>
    );
  return <StepRow row={row} selected={selected} inspect={() => inspect(row.item.id)} />;
}

/** 同一组聊天条目提供另一种投影，不维护第二份会话正文。 */
export function TrajectoryView({ items, running }: { items: ChatItem[]; running: boolean }) {
  const [filter, setFilter] = useState<TrajectoryFilter>('all');
  const context = useChat((state) => state.contextUsage);
  const rows = useMemo(() => filterTrajectory(projectTrajectory(items), filter), [items, filter]);
  const list = useRef<VirtuosoHandle>(null);
  const atBottom = useRef(true);
  const [bottom, setBottom] = useState(true);
  useEffect(() => {
    if (running && atBottom.current) list.current?.autoscrollToBottom();
  }, [items, running]);
  return (
    <div className="trajectory-view relative flex min-h-0 flex-1 flex-col">
      <div className="trajectory-toolbar">
        <SegmentedControl<TrajectoryFilter>
          label="轨迹类型"
          value={filter}
          onChange={(value) => {
            setFilter(value);
            atBottom.current = false;
          }}
          options={filters}
        />
      </div>
      {(filter === 'all' || filter === 'context') && <TrajectoryContext />}
      {!rows.length ? (
        <p className="m-auto px-4 py-8 text-sm text-muted-foreground">
          {context && filter === 'context' ? '暂无压缩事件' : '暂无此类记录'}
        </p>
      ) : (
        <Virtuoso
          key={filter}
          ref={list}
          className="min-h-0 flex-1"
          data={rows}
          computeItemKey={(_index, row) => row.id}
          defaultItemHeight={48}
          increaseViewportBy={{ top: 200, bottom: 200 }}
          initialTopMostItemIndex={initialPosition(running, filter)}
          followOutput={(isAtBottom) => (isAtBottom ? 'auto' : false)}
          atBottomThreshold={32}
          atBottomStateChange={(value) => {
            atBottom.current = value;
            setBottom(value);
          }}
          role="log"
          aria-label="执行轨迹"
          aria-live="off"
          aria-busy={running}
          itemContent={(_index, row) => <TrajectoryEntry row={row} filter={filter} />}
        />
      )}
      {!bottom && rows.length > 0 && (
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
