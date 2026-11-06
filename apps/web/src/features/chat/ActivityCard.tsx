import { ChevronRight, ListTree } from 'lucide-react';
import type { ChatItem } from './chat-reducer';
import { finiteCount, formatDuration } from './chat-metrics';
import type { ExpandedProps } from './timeline-model';

type ActivityItem = Extract<ChatItem, { kind: 'activity' }>;
const labels = { running: '进行中', completed: '完成', failed: '失败', cancelled: '已取消', unknown: '状态未知' };

export function activityStatus(item: ActivityItem): string {
  return item.incomplete ? '未完成' : labels[item.status];
}

export function ActivityCard({ item, expanded, onExpandedChange }: { item: ActivityItem } & ExpandedProps) {
  return (
    <details
      className="group/activity min-w-0 text-[13px]"
      open={expanded}
      onToggle={(event) => {
        if (event.currentTarget.open !== expanded) onExpandedChange?.(event.currentTarget.open);
      }}
    >
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted/50">
        <ListTree aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{activityStatus(item)}</span>
        {finiteCount(item.durationMs) && (
          <span className="text-xs text-muted-foreground">{formatDuration(item.durationMs)}</span>
        )}
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground group-open/activity:rotate-90" />
      </summary>
      <div className="mt-1 ml-3.5 space-y-3 border-l border-border pl-4">
        {item.input !== undefined && (
          <pre className="max-h-72 overflow-auto text-xs leading-5 whitespace-pre-wrap break-words">
            {JSON.stringify(item.input, null, 2)}
          </pre>
        )}
        {item.output !== undefined && (
          <pre className="max-h-96 overflow-auto text-xs leading-5 whitespace-pre-wrap break-words">{item.output}</pre>
        )}
      </div>
    </details>
  );
}
