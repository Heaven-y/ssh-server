import { useEffect, useRef, useState, type ReactNode } from 'react';

export function FilePanelFrame({ children, close }: { children: ReactNode; close(): void }) {
  const [narrow, setNarrow] = useState(() => !window.matchMedia('(min-width: 1280px)').matches);
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (document.activeElement instanceof HTMLElement) trigger.current = document.activeElement;
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)');
    const update = () => setNarrow(!media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const restore = () => {
      if (trigger.current?.isConnected) trigger.current.focus();
    };
    if (!narrow) {
      panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
      return restore;
    }
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      restore();
    };
  }, [narrow]);
  const style = 'flex min-h-0 flex-col bg-card text-foreground';
  if (!narrow)
    return (
      <aside
        ref={panel}
        aria-label="工作区文件"
        className={`${style} w-[clamp(400px,38vw,680px)] shrink-0 border-l border-border`}
      >
        {children}
      </aside>
    );
  return (
    <dialog
      ref={dialog}
      aria-label="工作区文件"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-auto h-[calc(100dvh-32px)] w-[min(900px,calc(100vw-32px))] overflow-hidden rounded-lg border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/60"
    >
      <div className={`${style} h-full`}>{children}</div>
    </dialog>
  );
}
