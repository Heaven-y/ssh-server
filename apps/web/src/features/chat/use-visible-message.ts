import { useCallback, useEffect, useRef, useState } from 'react';

/** 虚拟列表的 range 包含预渲染区域，高亮须按实际视口测量已挂载行。 */
export function useVisibleMessage() {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const [index, setIndex] = useState<number>();
  const measure = useCallback(() => {
    frame.current = undefined;
    if (!scroller) return;
    const viewport = scroller.getBoundingClientRect();
    for (const row of scroller.querySelectorAll<HTMLElement>('[data-chat-index]')) {
      const bounds = row.getBoundingClientRect();
      if (bounds.bottom <= viewport.top + 1 || bounds.top >= viewport.bottom) continue;
      setIndex(Number(row.dataset.chatIndex));
      return;
    }
  }, [scroller]);
  const update = useCallback(() => {
    if (frame.current === undefined) frame.current = requestAnimationFrame(measure);
  }, [measure]);
  useEffect(() => {
    if (!scroller) return;
    scroller.addEventListener('scroll', update, { passive: true });
    // 远距离跳转先滚动再挂载新行，等节点替换后重新测量。
    const changes = new MutationObserver(update);
    changes.observe(scroller, { childList: true, subtree: true });
    update();
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      changes.disconnect();
      scroller.removeEventListener('scroll', update);
    };
  }, [scroller, update]);
  const attach = useCallback((element: HTMLElement | Window | null) => {
    setScroller(element instanceof HTMLElement ? element : null);
  }, []);
  return { index, setIndex, update, attach };
}
