import { useEffect, useRef, useState, type ReactNode } from 'react';

export function FilePanelFrame({ children, close }: { children: ReactNode; close(): void }) {
  const [narrow, setNarrow] = useState(() => !window.matchMedia('(min-width: 1280px)').matches);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const focused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (document.activeElement instanceof HTMLElement) trigger.current = document.activeElement;
    return () => {
      if (trigger.current?.isConnected) trigger.current.focus();
    };
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)');
    const update = () => setNarrow(!media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (narrow) element.showModal();
    else element.show();
    if (focused.current?.isConnected && element.contains(focused.current)) focused.current.focus();
    else element.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (document.activeElement instanceof HTMLElement && element.contains(document.activeElement))
        focused.current = document.activeElement;
      element.close();
    };
  }, [narrow]);
  const style = 'flex min-h-0 flex-col bg-card text-foreground';
  // 保持同一个 DOM 子树；断点只改变呈现方式，不重建编辑器或 SFTP 会话。
  return (
    <dialog
      ref={dialog}
      role={narrow ? 'dialog' : 'complementary'}
      aria-label="工作区文件"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className={
        narrow
          ? 'm-auto h-[calc(100dvh-32px)] w-[min(900px,calc(100vw-32px))] overflow-hidden rounded-lg border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/60'
          : 'relative m-0 h-full max-h-none w-[clamp(400px,38vw,680px)] max-w-none shrink-0 overflow-hidden border-0 border-l border-border bg-card p-0 text-foreground'
      }
    >
      <div className={`${style} h-full`}>{children}</div>
    </dialog>
  );
}
