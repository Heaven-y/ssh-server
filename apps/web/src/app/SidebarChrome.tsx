import { Menu, MenuButton, MenuItem, useMenuStore } from '@ariakit/react';
import {
  ChevronUp,
  CircleUserRound,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  Sun,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useUiPreferences } from '../ui/ui-preferences';
import { desktopChrome } from '../lib/desktop-bridge';
import { sidebarItemClass, sidebarMenuClass, sidebarMenuItemClass } from '../ui/sidebar-styles';

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
  const theme = useUiPreferences((state) => state.theme);
  const menu = useMenuStore({ placement: collapsed ? 'right-end' : 'top-start' });
  const ThemeIcon = theme === 'light' ? Moon : Sun;
  return (
    <footer className="shrink-0 pt-2">
      <MenuButton
        store={menu}
        render={<button type="button" />}
        aria-label="设置与外观"
        title="设置与外观"
        className={sidebarItemClass(collapsed)}
      >
        <CircleUserRound aria-hidden className="size-5 shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1">设置与外观</span>
            <ChevronUp aria-hidden className="size-3.5 text-muted-foreground" />
          </>
        )}
      </MenuButton>
      <Menu store={menu} portal unmountOnHide gutter={6} aria-label="设置与外观" className={sidebarMenuClass}>
        {onOpenSettings && (
          <MenuItem
            className={sidebarMenuItemClass}
            onClick={() => {
              menu.hide();
              onOpenSettings();
            }}
          >
            <Settings2 aria-hidden className="size-4" />
            设置
          </MenuItem>
        )}
        <MenuItem
          className={sidebarMenuItemClass}
          onClick={() => {
            menu.hide();
            useUiPreferences.getState().toggleTheme();
          }}
        >
          <ThemeIcon aria-hidden className="size-4" />
          {theme === 'light' ? '切换为深色模式' : '切换为浅色模式'}
        </MenuItem>
      </Menu>
    </footer>
  );
}
