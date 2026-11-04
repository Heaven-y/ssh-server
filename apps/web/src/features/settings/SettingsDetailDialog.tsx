import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowLeft, Settings2, X } from 'lucide-react';
import { buttonClass } from '../../ui/styles';

/** 原生设置的单层对话框；每个编辑视图自行处理草稿与离开保护。 */
export function SettingsDetailDialog({
  title,
  children,
  footer,
  backLabel = '返回产品设置',
  busy = false,
  onBack,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  backLabel?: string;
  busy?: boolean;
  onBack(): void;
  onClose(): void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto w-[min(960px,calc(100vw-32px))] max-h-[calc(100vh-40px)] overflow-hidden rounded-lg border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/60"
    >
      <div className="flex max-h-[calc(100vh-40px)] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id={id} className="flex min-w-0 items-center gap-2 font-semibold">
            <Settings2 aria-hidden className="size-5 shrink-0" />
            {title}
          </h2>
          <button
            type="button"
            className={buttonClass('ghost')}
            aria-label="关闭设置"
            disabled={busy}
            onClick={onClose}
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>
        <div className="space-y-4 overflow-y-auto p-5">
          <button type="button" className={buttonClass('ghost')} disabled={busy} onClick={onBack}>
            <ArrowLeft aria-hidden className="size-4" />
            {backLabel}
          </button>
          {children}
        </div>
        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}
