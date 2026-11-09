import { useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle, type ListRange } from 'react-virtuoso';
import { Tooltip, TooltipAnchor, TooltipProvider } from '@ariakit/react';
import type { TimelineRow } from './timeline-model';

type MessageLocation = { id: string; rowIndex: number; preview: string };
function focusableIndex(range: ListRange, active: number, keyboard?: number) {
  const visible = (index: number) => index >= range.startIndex && index <= range.endIndex;
  if (keyboard !== undefined && visible(keyboard)) return keyboard;
  return visible(active) ? active : range.startIndex;
}
function messageLocations(rows: TimelineRow[]): MessageLocation[] {
  return rows.flatMap((row, rowIndex) =>
    row.kind === 'message' && row.item.kind === 'user'
      ? [
          {
            id: row.item.id,
            rowIndex,
            preview: row.item.text.trim().replace(/\s+/g, ' ').slice(0, 180) || '（空消息）',
          },
        ]
      : [],
  );
}

/** 刻度也使用虚拟列表；长会话可滚动、按方向键或 Home/End 到达每一条提问。 */
export function UserMessageNavigation({
  rows,
  activeRow,
  jump,
}: {
  rows: TimelineRow[];
  activeRow: number;
  jump(rowIndex: number): void;
}) {
  const messages = useMemo(() => messageLocations(rows), [rows]);
  const list = useRef<VirtuosoHandle>(null);
  const buttons = useRef(new Map<number, HTMLElement>());
  const pendingFocus = useRef<number | undefined>(undefined);
  const [keyboardIndex, setKeyboardIndex] = useState<number>();
  const [range, setRange] = useState<ListRange>({ startIndex: 0, endIndex: 0 });
  const active = Math.max(
    0,
    messages.findLastIndex((message) => message.rowIndex <= activeRow),
  );
  useEffect(() => {
    if (messages.length) list.current?.scrollIntoView({ index: active, align: 'center', behavior: 'auto' });
  }, [active, messages.length]);
  const focus = (index: number) => {
    const target = Math.max(0, Math.min(messages.length - 1, index));
    pendingFocus.current = target;
    setKeyboardIndex(target);
    list.current?.scrollToIndex({ index: target, align: 'center', behavior: 'auto' });
    buttons.current.get(target)?.focus();
  };
  if (!messages.length) return null;
  return (
    <nav aria-label="用户消息导航" className="message-navigation absolute inset-y-4 right-1 z-10 flex w-6 items-center">
      <Virtuoso
        ref={list}
        aria-label="用户消息刻度"
        className="message-navigation-list w-full"
        style={{ height: Math.min(messages.length * 20, 320), maxHeight: '100%' }}
        data={messages}
        fixedItemHeight={20}
        rangeChanged={setRange}
        initialTopMostItemIndex={active}
        computeItemKey={(_index, message) => message.id}
        itemContent={(index, message) => (
          <TooltipProvider placement="left" timeout={180}>
            <TooltipAnchor
              render={<button type="button" />}
              ref={(element) => {
                if (!element) {
                  buttons.current.delete(index);
                  return;
                }
                buttons.current.set(index, element);
                if (pendingFocus.current === index) {
                  element.focus();
                  pendingFocus.current = undefined;
                }
              }}
              aria-label={`跳转到第 ${index + 1} 条消息：${message.preview}`}
              aria-current={active === index ? 'true' : undefined}
              tabIndex={index === focusableIndex(range, active, keyboardIndex) ? 0 : -1}
              className="message-navigation-button group flex h-5 w-6 items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => {
                setKeyboardIndex(index);
                jump(message.rowIndex);
              }}
              onKeyDown={(event) => {
                const targets: Record<string, number> = {
                  ArrowUp: index - 1,
                  ArrowDown: index + 1,
                  Home: 0,
                  End: messages.length - 1,
                };
                if (!(event.key in targets)) return;
                event.preventDefault();
                focus(targets[event.key]!);
              }}
            >
              <span
                aria-hidden
                className="message-navigation-tick h-0.5 w-2 rounded-full bg-muted-foreground/40 group-hover:w-3 group-hover:bg-foreground group-aria-current:w-3 group-aria-current:bg-foreground"
              />
            </TooltipAnchor>
            <Tooltip
              portal
              unmountOnHide
              className="z-50 max-w-72 rounded-lg border border-border bg-card px-3 py-2 text-xs leading-5 text-foreground shadow-lg"
            >
              <p className="mb-1 text-muted-foreground">第 {index + 1} 条消息</p>
              <p className="line-clamp-4 break-words">{message.preview}</p>
            </Tooltip>
          </TooltipProvider>
        )}
      />
    </nav>
  );
}
