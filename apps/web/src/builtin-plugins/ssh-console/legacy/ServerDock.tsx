import { lazy, Suspense, useEffect } from 'react';
import { Activity, FolderTree, Minus, RotateCcw, Server, TerminalSquare } from 'lucide-react';
import { isBoundWorkspace, type BoundWorkspace, type Workspace } from '@agentdeck/shared/projects';
import { terminalTargetKey, workspaceTerminalTarget } from '@agentdeck/shared/ssh';
import { buttonClass } from '../../../ui/styles';
import { useUiPreferences } from '../../../ui/ui-preferences';
import { ResourcesPanel } from './resources/ResourcesPanel';
import { RemoteFilesPanel } from './remote-files/RemoteFilesPanel';

const TerminalDock = lazy(() => import('./terminal/TerminalDock'));

export type ServerDockView = 'terminal' | 'resources' | 'files';

const VIEWS = [
  { id: 'terminal', label: '终端', icon: TerminalSquare },
  { id: 'resources', label: '资源', icon: Activity },
  { id: 'files', label: '文件', icon: FolderTree },
] as const;

const HINTS = {
  terminal: '选中项目并绑定服务器后，可在这里开终端窗口。',
  resources: '资源采样以服务器档案为目标，需要项目绑定服务器与默认远端目录。',
  files: '文件浏览以服务器档案为目标，需要项目绑定服务器与默认远端目录。',
} as const;

const READY = {
  terminal: '终端在第一次打开时挂载；之后切换视图与收起都不重建连接。',
  resources: '',
  files: '文件浏览在第一次打开时挂载；之后切换视图与收起都保留已打开的路径。',
} as const;

function viewMeta(view: ServerDockView) {
  return VIEWS.find((item) => item.id === view)!;
}

function DockMessage({ view, children }: { view: ServerDockView; children: React.ReactNode }) {
  const Icon = viewMeta(view).icon;
  return (
    <div className="m-auto max-w-72 space-y-2 px-4 text-center">
      <Icon aria-hidden className="mx-auto size-6 text-muted-foreground" />
      {children}
    </div>
  );
}

function UnboundHint({ view }: { view: ServerDockView }) {
  return (
    <DockMessage view={view}>
      <p className="text-sm font-medium">当前项目未绑定服务器</p>
      <p className="text-xs leading-5 text-muted-foreground">{HINTS[view]}</p>
    </DockMessage>
  );
}

function PendingView({ view, open }: { view: ServerDockView; open(): void }) {
  return (
    <DockMessage view={view}>
      <p className="text-xs leading-5 text-muted-foreground">{READY[view]}</p>
      <button type="button" className="text-sm text-accent underline underline-offset-4" onClick={open}>
        打开{viewMeta(view).label}
      </button>
    </DockMessage>
  );
}

function DockTabs({ view, select }: { view: ServerDockView; select(view: ServerDockView): void }) {
  return (
    <div role="tablist" aria-label="服务器视图" className="flex min-w-0 items-center gap-0.5">
      {VIEWS.map((item) => {
        const Icon = item.icon;
        const selected = item.id === view;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`server-dock-tab-${item.id}`}
            aria-selected={selected}
            aria-controls="server-dock-panel"
            className={`inline-flex min-h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors ${
              selected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            }`}
            onClick={() => select(item.id)}
          >
            <Icon aria-hidden className="size-3.5" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export type ServerDockProps = {
  workspace?: Workspace;
  open: boolean;
  view: ServerDockView;
  /** 已挂载过的视图：终端与文件按需挂载，挂上后切换视图与收起都不卸载。 */
  loaded: ReadonlySet<ServerDockView>;
  onSelectView(view: ServerDockView): void;
  onHide(): void;
};

/**
 * 右侧服务器面板的停靠区骨架：终端 / 资源 / 文件共用一条宽度与一次收起，
 * 收起、切换视图、切换项目都不重建内容父子树，已开的 PTY 与资源快照随之保留。
 * Slurm 仍留在资源视图里，等后续任务再拆成独立标签。
 */
export function ServerDock({ workspace, open, view, loaded, onSelectView, onHide }: ServerDockProps) {
  useEffect(() => {
    // 收起后焦点留在被隐藏的面板里会丢失键盘位置，交回顶栏入口。
    if (open) return;
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-controls="server-dock"]');
    if (trigger && !trigger.disabled && document.activeElement?.closest('#server-dock')) trigger.focus();
  }, [open]);
  const bound: BoundWorkspace | undefined = workspace && isBoundWorkspace(workspace) ? workspace : undefined;
  const targetKey = bound ? terminalTargetKey(workspaceTerminalTarget(bound)) : '';
  const active = (target: ServerDockView) => open && view === target;
  return (
    <aside
      id="server-dock"
      aria-label="服务器面板"
      data-view={view}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !(event.target instanceof Element)) return;
        if (!event.currentTarget.contains(event.target) || event.target.closest('dialog, [role="dialog"]')) return;
        event.preventDefault();
        onHide();
      }}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-border/70 bg-card text-foreground"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/70 bg-muted/20 px-2 py-1">
        <h2 className="flex min-h-7 items-center gap-1.5 px-1 text-xs font-semibold">
          <Server aria-hidden className="size-3.5 text-muted-foreground" />
          服务器面板
        </h2>
        <DockTabs view={view} select={onSelectView} />
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            aria-label="复位服务器面板"
            title="恢复默认分屏尺寸"
            className={buttonClass('ghost')}
            onClick={() => useUiPreferences.getState().resetDockedSizes()}
          >
            <RotateCcw aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            aria-label="收起服务器面板"
            title="收起服务器面板"
            className={buttonClass('ghost')}
            onClick={onHide}
          >
            <Minus aria-hidden className="size-4" />
          </button>
        </div>
      </header>
      <div
        id="server-dock-panel"
        role="tabpanel"
        aria-labelledby={`server-dock-tab-${view}`}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <section
          aria-label="终端视图"
          hidden={view !== 'terminal'}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {loaded.has('terminal') ? (
            <Suspense
              fallback={
                <p role="status" className="p-3 text-sm text-muted-foreground">
                  正在打开终端…
                </p>
              }
            >
              <TerminalDock workspace={bound} visible={active('terminal')} overlay={false} onHide={onHide} />
            </Suspense>
          ) : (
            <PendingView view="terminal" open={() => onSelectView('terminal')} />
          )}
        </section>
        <section
          aria-label="资源视图"
          hidden={view !== 'resources'}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {!bound ? (
            <UnboundHint view="resources" />
          ) : (
            <ResourcesPanel key={targetKey} workspace={bound} active={active('resources')} />
          )}
        </section>
        <section
          aria-label="文件视图"
          hidden={view !== 'files'}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {!loaded.has('files') ? (
            <PendingView view="files" open={() => onSelectView('files')} />
          ) : !bound ? (
            <UnboundHint view="files" />
          ) : (
            <RemoteFilesPanel key={targetKey} workspace={bound} active={active('files')} />
          )}
        </section>
      </div>
    </aside>
  );
}
