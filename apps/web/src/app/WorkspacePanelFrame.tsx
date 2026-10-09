import { useEffect, useRef, type ReactNode } from 'react';
import { Activity, ArrowDownRight, FileCode2, GripVertical, Minus, RotateCcw } from 'lucide-react';
import { buttonClass } from '../ui/styles';
import type { WorkspacePanelKind } from './floating-panel-geometry';
import { useFloatingPanel } from './use-floating-panel';

/** 非模态工具面板：只隐藏子树，文件编辑器、登记与终端不随布局重建。 */
export function WorkspacePanelFrame({
  kind,
  children,
  opened,
  front,
  onActivate,
  hide,
}: {
  kind: WorkspacePanelKind;
  children: ReactNode;
  opened: boolean;
  front: boolean;
  onActivate(): void;
  hide(): void;
}) {
  const label = kind === 'resources' ? '资源' : '文件';
  const Icon = kind === 'resources' ? Activity : FileCode2;
  const id = `workspace-${kind}-panel`;
  const panel = useRef<HTMLElement>(null);
  const focused = useRef<HTMLElement | null>(null);
  const floating = useFloatingPanel(kind);
  useEffect(() => {
    const element = panel.current;
    if (!element || !opened) return;
    const previous = document.activeElement;
    // 默认展开不能抢走正文焦点；用户主动打开时恢复上次的面板焦点。
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
      onPointerDownCapture={onActivate}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLElement) focused.current = event.target;
        onActivate();
      }}
      onKeyDown={(event) => {
        // 子dialog（含busy确认框）和已消费Escape的编辑器自行处理，不连带收起面板。
        if (event.key !== 'Escape' || event.defaultPrevented || !(event.target instanceof Element)) return;
        if (!event.currentTarget.contains(event.target) || event.target.closest('dialog, [role="dialog"]')) return;
        event.preventDefault();
        hide();
      }}
      style={{ ...floating.rect, zIndex: front ? 30 : 20 }}
      className={`fixed m-0 min-h-0 flex-col overflow-hidden rounded-xl border bg-card text-foreground shadow-xl ${opened ? 'flex' : 'hidden'} ${front ? 'border-border-strong' : 'border-border'}`}
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border bg-muted/30 px-2 py-1">
        <button
          type="button"
          aria-label={`移动${label}面板`}
          title="拖动移动；方向键微调，Shift 加速"
          className="flex min-h-9 min-w-0 flex-1 touch-none select-none items-center gap-2 rounded-lg px-1.5 text-left text-sm font-semibold hover:bg-muted active:cursor-grabbing cursor-grab"
          {...floating.move}
        >
          <GripVertical aria-hidden className="size-4 text-muted-foreground" />
          <Icon aria-hidden className="size-4" />
          {label}
        </button>
        <button
          type="button"
          aria-label={`复位${label}面板`}
          title="恢复默认位置和大小"
          className={buttonClass('ghost')}
          onClick={floating.reset}
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
      <div aria-hidden className="h-6 shrink-0 border-t border-border/60 bg-muted/20" />
      <button
        type="button"
        aria-label={`调整${label}面板大小`}
        title="拖动调整大小；方向键微调，Shift 加速"
        className="absolute bottom-0 right-0 flex size-6 touch-none select-none items-center justify-center rounded-tl-md text-muted-foreground hover:bg-muted cursor-se-resize"
        {...floating.resize}
      >
        <ArrowDownRight aria-hidden className="size-4" />
      </button>
    </aside>
  );
}
