import { useEffect, useRef, type ReactNode, type PointerEvent } from 'react';

/** 光影限制在输入框内部；鼠标坐标只更新装饰样式，不驱动消息重渲染。 */
export function SpotlightSurface({
  enabled,
  children,
  className = '',
}: {
  enabled: boolean;
  children: ReactNode;
  className?: string;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const point = useRef({ x: 0, y: 0 });
  const hide = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (surface.current) delete surface.current.dataset.illuminated;
  };
  useEffect(() => {
    if (!enabled) {
      hide();
      return;
    }
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', hide);
    return () => {
      hide();
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [enabled]);
  const illuminate = (event: PointerEvent<HTMLDivElement>) => {
    // React portal 仍沿组件树冒泡，只有输入框实际 DOM 内的鼠标事件可以点亮。
    if (!(event.target instanceof Node) || !surface.current?.contains(event.target)) {
      hide();
      return;
    }
    if (!enabled || event.pointerType !== 'mouse' || !document.hasFocus()) {
      hide();
      return;
    }
    point.current = { x: event.clientX, y: event.clientY };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const element = surface.current;
      if (!element || !document.hasFocus() || document.visibilityState === 'hidden') return;
      const bounds = element.getBoundingClientRect();
      element.style.setProperty('--spotlight-x', `${point.current.x - bounds.left}px`);
      element.style.setProperty('--spotlight-y', `${point.current.y - bounds.top}px`);
      element.dataset.illuminated = 'true';
    });
  };
  return (
    <div
      ref={surface}
      className={`ui-spotlight ${className}`}
      onPointerEnter={illuminate}
      onPointerMove={illuminate}
      onPointerLeave={hide}
    >
      {children}
    </div>
  );
}
