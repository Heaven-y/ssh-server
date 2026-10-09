import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useUiPreferences } from '../ui/ui-preferences';
import {
  changePanel,
  defaultPanelRect,
  fitPanel,
  type PanelRect,
  type WorkspacePanelKind,
} from './floating-panel-geometry';

type Mode = 'move' | 'resize';
type Gesture = { pointer: number; x: number; y: number; mode: Mode; rect: PanelRect };
function viewport() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    top: Math.max(60, document.getElementById('workspace-topbar')?.getBoundingClientRect().bottom ?? 0) + 12,
  };
}
const offsets: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** 使用指针捕获与局部键盘操作，不接管聊天、编辑器或终端的快捷键。 */
export function useFloatingPanel(kind: WorkspacePanelKind) {
  const [rect, setRect] = useState(() =>
    defaultPanelRect(kind, viewport(), kind === 'files' ? useUiPreferences.getState().fileWidth : 420),
  );
  const current = useRef(rect);
  const gesture = useRef<Gesture | null>(null);
  const update = (next: PanelRect, remember = false) => {
    current.current = fitPanel(next, viewport());
    setRect(current.current);
    if (remember && kind === 'files') useUiPreferences.getState().setWidth('fileWidth', current.current.width);
  };
  useLayoutEffect(() => {
    const changed = () => {
      current.current = fitPanel(current.current, viewport());
      setRect(current.current);
    };
    window.addEventListener('resize', changed);
    const observer = new ResizeObserver(changed);
    const topbar = document.getElementById('workspace-topbar');
    if (topbar) observer.observe(topbar);
    changed();
    return () => {
      window.removeEventListener('resize', changed);
      observer.disconnect();
    };
  }, []);
  const start = (event: PointerEvent<HTMLButtonElement>, mode: Mode) => {
    if (event.button !== 0 || gesture.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, mode, rect: current.current };
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const start = gesture.current;
    if (!start || start.pointer !== event.pointerId) return;
    update(changePanel(start.rect, start.mode, event.clientX - start.x, event.clientY - start.y));
  };
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    if (gesture.current?.pointer !== event.pointerId) return;
    const remember = gesture.current.mode === 'resize';
    gesture.current = null;
    update(current.current, remember);
  };
  const key = (event: KeyboardEvent<HTMLButtonElement>, mode: Mode) => {
    const offset = offsets[event.key];
    if (!offset || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 10;
    update(changePanel(current.current, mode, offset[0] * step, offset[1] * step), mode === 'resize');
  };
  const pointerEvents = {
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
  };
  return {
    rect,
    move: {
      ...pointerEvents,
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => start(event, 'move'),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => key(event, 'move'),
    },
    resize: {
      ...pointerEvents,
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => start(event, 'resize'),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => key(event, 'resize'),
    },
    reset: () => {
      gesture.current = null;
      update(defaultPanelRect(kind, viewport()), true);
    },
  };
}
