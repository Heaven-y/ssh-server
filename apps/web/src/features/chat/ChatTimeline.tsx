import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { buttonClass } from '../../ui/styles';
import type { ChatItem } from './chat-reducer';
import { MessageItem } from './MessageItem';
import { ToolGroup } from './ToolGroup';
import { projectTimeline } from './timeline-model';

/** 动态测量和跟随只交给Virtuoso；展开状态留在列表外，虚拟卸载不丢选择。 */
export function ChatTimeline({ items, running }: { items: ChatItem[]; running: boolean }) {
  const rows = useMemo(() => projectTimeline(items), [items]);
  const list = useRef<VirtuosoHandle>(null);
  const atBottom = useRef(true);
  const [bottom, setBottom] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const setOpen = useCallback((id: string, open: boolean) => {
    setExpanded((current) => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  // 同一个assistant条目持续增高不会改变条目数量；只在贴底时触发官方跟随。
  useEffect(() => {
    if (atBottom.current) list.current?.autoscrollToBottom();
  }, [items]);
  return (
    <div className="relative min-h-0 flex-1">
      <Virtuoso
        ref={list}
        className="h-full"
        data={rows}
        computeItemKey={(_index, row) => row.id}
        defaultItemHeight={120}
        increaseViewportBy={{ top: 300, bottom: 300 }}
        initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
        followOutput={(isAtBottom) => (isAtBottom ? 'auto' : false)}
        atBottomStateChange={(value) => {
          atBottom.current = value;
          setBottom(value);
        }}
        atBottomThreshold={32}
        role="log"
        aria-label="对话内容"
        aria-live="polite"
        aria-busy={running}
        itemContent={(_index, row) => (
          <div data-chat-row={row.id} className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6">
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
        )}
      />
      {!bottom && (
        <button
          type="button"
          className={`${buttonClass('outline')} absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap bg-card shadow-sm`}
          onClick={() => list.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })}
        >
          <ArrowDown aria-hidden className="size-4" />
          回到底部
        </button>
      )}
    </div>
  );
}
