import { useEffect, useRef, type ReactNode } from 'react';
import { Activity, FileCode2, Minus, RotateCcw } from 'lucide-react';
import { buttonClass } from '../ui/styles';
import { useUiPreferences } from '../ui/ui-preferences';

export type WorkspacePanelKind = 'resources' | 'files';
/** 停靠工具面板：收起仅隐藏子树，不释放文件编辑器和编辑登记。 */
export function WorkspacePanelFrame({
  kind,
  children,
  opened,
  hide,
}: {
  kind: WorkspacePanelKind;
  children: ReactNode;
  opened: boolean;
  hide(): void;
}) {
  const label = kind === 'resources' ? '资源' : '文件';
  const Icon = kind === 'resources' ? Activity : FileCode2;
  const id = `workspace-${kind}-panel`;
  const panel = useRef<HTMLElement>(null);
  const focused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = panel.current;
    if (!element || !opened) return;
    const previous = document.activeElement;
    if (previous instanceof HTMLElement && previous !== document.body && !element.contains(previous)) {
      const last = focused.current;
      if (last?.isConnected && !last.closest('[hidden], [inert]')) last.focus();
      else element.querySelector<HTMLButtonElement>('button')?.focus();
    }
    return () => {
      if (!element.contains(document.activeElement) && document.activeElement !== document.body) return;
      const trigger = document.querySelector<HTMLButtonElement>(`button[aria-controls="${id}"]`);
      if (trigger && !trigger.disabled) trigger.focus();
    };
  }, [opened, id]);
  return (
    <aside
      id={id}
      ref={panel}
      aria-label={`${label}面板`}
      hidden={!opened}
      inert={!opened}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLElement) focused.current = event.target;
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !(event.target instanceof Element)) return;
        if (!event.currentTarget.contains(event.target) || event.target.closest('dialog, [role="dialog"]')) return;
        event.preventDefault();
        hide();
      }}
      className={`h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card text-foreground ${opened ? 'flex' : 'hidden'}`}
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border bg-muted/30 px-2 py-1">
        <h2 className="flex min-h-9 min-w-0 flex-1 items-center gap-2 px-1.5 text-sm font-semibold">
          <Icon aria-hidden className="size-4" />
          {label}
        </h2>
        <button
          type="button"
          aria-label={`复位${label}面板`}
          title="恢复默认分屏尺寸"
          className={buttonClass('ghost')}
          onClick={() => useUiPreferences.getState().resetDockedSizes()}
        >
          <RotateCcw aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          aria-label={`收起${label}面板`}
          title={kind === 'files' ? '收起，保留未保存内容' : '收起资源面板'}
          className={buttonClass('ghost')}
          onClick={hide}
        >
          <Minus aria-hidden className="size-4" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
    </aside>
  );
}
