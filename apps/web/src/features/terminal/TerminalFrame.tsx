import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** 同一子树改变呈现方式；隐藏及最大化不会卸载终端实例。 */
export function TerminalFrame({
  children,
  visible,
  overlay,
  onHide,
}: {
  children: ReactNode;
  visible: boolean;
  overlay: boolean;
  onHide: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const focused = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const element = dialog.current!;
    if (!visible) return;
    if (document.activeElement instanceof HTMLElement && !element.contains(document.activeElement))
      trigger.current = document.activeElement;
    if (overlay) element.showModal();
    else element.show();
    if (focused.current?.isConnected && element.contains(focused.current)) focused.current.focus();
    return () => {
      if (document.activeElement instanceof HTMLElement && element.contains(document.activeElement))
        focused.current = document.activeElement;
      element.close();
      if (trigger.current?.isConnected) trigger.current.focus();
    };
  }, [visible, overlay]);
  return (
    <dialog
      ref={dialog}
      role={overlay ? 'dialog' : 'region'}
      aria-label="网页终端"
      onCancel={(event) => {
        event.preventDefault();
        onHide();
      }}
      className={
        overlay
          ? 'fixed inset-4 m-auto h-[calc(100dvh-32px)] max-h-none w-[calc(100vw-32px)] max-w-none overflow-hidden rounded-lg border border-border bg-background p-0 text-foreground backdrop:bg-black/60'
          : 'relative m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 bg-background p-0 text-foreground'
      }
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col">{children}</div>
    </dialog>
  );
}
