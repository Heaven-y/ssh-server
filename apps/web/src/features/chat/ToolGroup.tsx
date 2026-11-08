import { ChevronRight, Files } from 'lucide-react';
import { ToolCard } from './ToolCard';
import { toolCounts, type ExpandedProps, type ToolItem } from './timeline-model';

export function ToolGroup({
  items,
  expanded,
  onExpandedChange,
  itemExpanded,
  setItemExpanded,
}: ExpandedProps & {
  expanded: boolean;
  items: ToolItem[];
  itemExpanded(id: string): boolean;
  setItemExpanded(id: string, open: boolean): void;
}) {
  const counts = toolCounts(items);
  return (
    <details
      className="tool-card group/reads min-w-0 text-[13px]"
      open={expanded}
      onToggle={(event) => {
        if (event.currentTarget.open !== expanded) onExpandedChange?.(event.currentTarget.open);
      }}
    >
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted/50">
        <Files aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>读取/搜索了 {items.length} 项</span>
          <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
            {counts.done > 0 && <span className="text-success">完成 {counts.done}</span>}
            {counts.running > 0 && <span className="text-muted-foreground">运行中 {counts.running}</span>}
            {counts.failed > 0 && <span className="text-destructive-foreground">失败 {counts.failed}</span>}
            {counts.incomplete > 0 && <span className="text-warning">结果未返回 {counts.incomplete} · 需核对</span>}
          </span>
        </span>
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/reads:rotate-90"
        />
      </summary>
      {expanded && (
        <div className="mt-1 ml-3.5 space-y-0.5 border-l border-border pl-3">
          {items.map((item) => (
            <ToolCard
              key={item.id}
              item={item}
              expanded={itemExpanded(item.id)}
              onExpandedChange={(open) => setItemExpanded(item.id, open)}
            />
          ))}
        </div>
      )}
    </details>
  );
}
