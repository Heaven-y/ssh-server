import { useRef, type HTMLAttributes, type PointerEvent } from 'react';

/** 光照只更新装饰层；不重建子树、不持有输入或业务状态。 */
export function SpotlightSurface({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  const bounds = useRef<DOMRect | undefined>(undefined);
  const illuminate = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || !bounds.current) return;
    event.currentTarget.style.setProperty('--spotlight-x', `${event.clientX - bounds.current.left}px`);
    event.currentTarget.style.setProperty('--spotlight-y', `${event.clientY - bounds.current.top}px`);
  };
  return (
    <div
      {...props}
      className={`ui-spotlight ${className}`}
      onPointerEnter={(event) => {
        bounds.current = event.currentTarget.getBoundingClientRect();
        illuminate(event);
      }}
      onPointerMove={illuminate}
      onPointerLeave={() => {
        bounds.current = undefined;
      }}
    >
      {children}
    </div>
  );
}
