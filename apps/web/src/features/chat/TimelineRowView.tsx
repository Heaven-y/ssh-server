import { MessageItem } from './MessageItem';
import { ToolGroup } from './ToolGroup';
import type { TimelineRow } from './timeline-model';

/**
 * 时间线单行：实时对话与只读历史共用同一套条目渲染，区别只在宿主列表
 * （实时对话用 Virtuoso 虚拟列表，历史用普通滚动容器）。
 */
export function TimelineRowView({
  row,
  expanded,
  setOpen,
}: {
  row: TimelineRow;
  expanded: ReadonlySet<string>;
  setOpen(id: string, open: boolean): void;
}) {
  return (
    <div data-chat-row={row.id} className="conversation-row">
      {row.kind === 'message' ? (
        <MessageItem
          item={row.item}
          expanded={expanded.has(row.item.id)}
          onExpandedChange={(open) => setOpen(row.item.id, open)}
        />
      ) : (
        <ToolGroup
          items={row.items}
          expanded={expanded.has(row.id)}
          onExpandedChange={(open) => setOpen(row.id, open)}
          itemExpanded={(id) => expanded.has(id)}
          setItemExpanded={setOpen}
        />
      )}
    </div>
  );
}
