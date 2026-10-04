import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { buttonClass } from '../../ui/styles';

/** 原生模态层可嵌套在文件面板中；关闭后恢复触发控件的焦点。 */
export function RemoteDialog({ title, close, children }: { title: string; close(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const element = dialog.current;
    element?.showModal();
    const input = element?.querySelector<HTMLInputElement>('input:not([disabled])');
    input?.focus();
    return () => {
      element?.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-auto max-h-[calc(100dvh-48px)] w-[min(560px,calc(100vw-32px))] overflow-auto rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/60"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border p-4">
        <h3 className="text-sm font-medium">{title}</h3>
        <button type="button" className={buttonClass('ghost')} aria-label={`关闭${title}`} onClick={close}>
          <X aria-hidden className="size-4" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
