import { PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useUiPreferences } from '../ui/ui-preferences';
import { SessionSortMenu } from '../features/sessions/SessionSortMenu';
import { desktopChrome } from '../lib/desktop-bridge';
import { sidebarItemClass } from '../ui/sidebar-styles';

const iconButtonClass =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent';

export function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  if (desktopChrome()) return null;
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const label = collapsed ? '展开侧栏' : '收起侧栏';
  return (
    <header className={`flex min-h-10 shrink-0 items-center ${collapsed ? 'justify-center' : 'justify-between px-3'}`}>
      {!collapsed && <span className="text-[15px] font-semibold tracking-tight">AgentDeck</span>}
      <button
        type="button"
        aria-label={label}
        title={label}
        className={iconButtonClass}
        onClick={() => useUiPreferences.getState().setSidebarCollapsed(!collapsed)}
      >
        <Icon aria-hidden className="size-4" />
      </button>
    </header>
  );
}

export function SidebarWorkspaces({
  collapsed,
  query,
  changeQuery,
  addProject,
}: {
  collapsed: boolean;
  query: string;
  changeQuery(query: string): void;
  addProject(): void;
}) {
  const [searching, setSearching] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const closeSearch = () => {
    changeQuery('');
    setSearching(false);
    searchButton.current?.focus();
  };
  return (
    <div className={collapsed ? 'hidden' : 'shrink-0 pt-4 pb-1'}>
      <div className="flex min-h-9 items-center gap-0.5 pl-3">
        <h2 className="mr-auto text-xs font-medium text-muted-foreground">工作区</h2>
        <SessionSortMenu />
        <button
          ref={searchButton}
          type="button"
          aria-label="搜索工作区与会话"
          title="搜索工作区与会话"
          aria-expanded={searching}
          className={iconButtonClass}
          onClick={() => {
            setSearching(true);
            requestAnimationFrame(() => searchInput.current?.focus());
          }}
        >
          <Search aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="添加项目"
          title="添加项目目录"
          className={iconButtonClass}
          onClick={addProject}
        >
          <Plus aria-hidden className="size-4" />
        </button>
      </div>
      {searching && (
        <div className="mx-1 mb-1 flex items-center rounded-lg border border-border-strong bg-background pl-2.5">
          <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchInput}
            type="search"
            aria-label="搜索工作区与会话"
            value={query}
            placeholder="搜索工作区与会话"
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeSearch();
            }}
            className="min-h-8 min-w-0 flex-1 bg-transparent px-2 text-xs outline-none"
          />
          <button
            type="button"
            aria-label="关闭搜索"
            title="关闭搜索"
            className={iconButtonClass}
            onClick={closeSearch}
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function SidebarFooter({ collapsed, onOpenSettings }: { collapsed: boolean; onOpenSettings?(): void }) {
  return (
    <footer className="shrink-0 pt-2">
      <button
        type="button"
        aria-label="设置"
        title="设置"
        className={sidebarItemClass(collapsed)}
        onClick={onOpenSettings}
      >
        <Settings2 aria-hidden className="size-4 shrink-0" />
        {!collapsed && <span>设置</span>}
      </button>
    </footer>
  );
}
