import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { buttonClass } from '../../ui/styles';
import type { ChatItem } from './chat-reducer';
import { TimelineRowView } from './TimelineRowView';
import { projectTimeline } from './timeline-model';
import { UserMessageNavigation } from './UserMessageNavigation';
import { useVisibleMessage } from './use-visible-message';

/** 动态测量和跟随只交给Virtuoso；展开状态留在列表外，虚拟卸载不丢选择。 */
export function ChatTimeline({ items, running }: { items: ChatItem[]; running: boolean }) {
  const rows = useMemo(() => projectTimeline(items.filter((item) => item.kind !== 'statistics')), [items]);
  const list = useRef<VirtuosoHandle>(null);
  const atBottom = useRef(true);
  const [bottom, setBottom] = useState(true);
  const visible = useVisibleMessage();
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
        followOutput={(isAtBottom) => (atBottom.current && isAtBottom ? 'auto' : false)}
        scrollerRef={visible.attach}
        rangeChanged={visible.update}
        atBottomStateChange={(value) => {
          atBottom.current = value;
          setBottom(value);
        }}
        atBottomThreshold={32}
        role="log"
        aria-label="对话内容"
        aria-live="polite"
        aria-busy={running}
        itemContent={(index, row) => <TimelineRowView row={row} index={index} expanded={expanded} setOpen={setOpen} />}
      />
      <UserMessageNavigation
        rows={rows}
        activeRow={visible.index ?? rows.length - 1}
        jump={(index) => {
          atBottom.current = false;
          setBottom(false);
          visible.setIndex(index);
          list.current?.scrollToIndex({ index, align: 'start', behavior: 'auto' });
        }}
      />
      {!bottom && (
        <button
          type="button"
          className={`${buttonClass('ghost')} conversation-scroll-bottom absolute bottom-4 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap border border-border-strong text-foreground shadow-md`}
          onClick={() => list.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })}
        >
          <ArrowDown aria-hidden className="size-4" />
          回到底部
        </button>
      )}
    </div>
  );
}
