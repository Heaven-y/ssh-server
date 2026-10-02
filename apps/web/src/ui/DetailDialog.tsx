import { useLayoutEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { buttonClass } from './styles';

/** 详情按需呈现，业务状态由外层持有；原生 dialog 管理键盘焦点与恢复。 */
export function DetailDialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  busy?: boolean;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element?.showModal();
    // 在 DOM 被移除前关闭；之后显式恢复触发点，避免焦点落回页面起点。
    return () => {
      element?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-auto max-h-[calc(100dvh-48px)] w-[min(620px,calc(100vw-48px))] overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/55"
    >
      <div className="flex max-h-[calc(100dvh-48px)] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-6 py-4">
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            className={buttonClass('ghost')}
            aria-label={`关闭${title}`}
            disabled={busy}
            onClick={close}
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto p-6">{children}</div>
      </div>
    </dialog>
  );
}
