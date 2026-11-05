import { useEffect, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { AppMenuName, DesktopChrome } from '../../../desktop/src/bridge';
import { desktopChrome } from '../lib/desktop-bridge';
import { useUiPreferences } from '../ui/ui-preferences';

const MENUS: { id: AppMenuName; label: string; shortcut: string }[] = [
  { id: 'file', label: 'File', shortcut: 'f' },
  { id: 'edit', label: 'Edit', shortcut: 'e' },
  { id: 'view', label: 'View', shortcut: 'v' },
  { id: 'window', label: 'Window', shortcut: 'w' },
];

function TitleBar({ bridge }: { bridge: DesktopChrome }) {
  const theme = useUiPreferences((state) => state.theme);
  const collapsed = useUiPreferences((state) => state.sidebarCollapsed || state.sidebarAutoCollapsed);
  const collapseLabel = collapsed ? '展开侧栏' : '收起侧栏';
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const pending = useRef(false);
  const [active, setActive] = useState<AppMenuName>();
  const [error, setError] = useState('');
  useEffect(() => {
    void bridge.setTheme(theme).catch(() => setError('标题栏主题未能更新，请重试。'));
  }, [bridge, theme]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'F10' && !event.shiftKey) {
        event.preventDefault();
        buttons.current[0]?.focus();
      }
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const index = MENUS.findIndex((menu) => menu.shortcut === event.key.toLowerCase());
      if (index < 0) return;
      event.preventDefault();
      buttons.current[index]?.click();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  const open = async (index: number) => {
    const menu = MENUS[index];
    const button = buttons.current[index];
    if (!menu || !button || pending.current) return;
    pending.current = true;
    setActive(menu.id);
    setError('');
    const bounds = button.getBoundingClientRect();
    try {
      await bridge.showMenu(menu.id, { x: bounds.left, y: bounds.bottom });
    } catch {
      setError('应用菜单未能打开，请重试。');
    } finally {
      pending.current = false;
      setActive(undefined);
    }
  };
  return (
    <header id="desktop-titlebar" className="desktop-titlebar" data-platform={window.agentDeck?.platform}>
      <button
        type="button"
        className="desktop-sidebar-toggle"
        aria-label={collapseLabel}
        title={collapseLabel}
        onClick={() => useUiPreferences.getState().setSidebarCollapsed(!collapsed)}
      >
        <CollapseIcon aria-hidden className="size-4" />
      </button>
      <span className="mr-3 select-none text-[13px] font-semibold tracking-tight">AgentDeck</span>
      <div role="menubar" aria-label="应用菜单" className="desktop-menubar">
        {MENUS.map((menu, index) => (
          <button
            key={menu.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={active === menu.id}
            aria-keyshortcuts={`Alt+${menu.shortcut}`}
            className="desktop-menu-button"
            onClick={() => void open(index)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                void open(index);
              }
              const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
              if (!offset) return;
              event.preventDefault();
              buttons.current[(index + offset + MENUS.length) % MENUS.length]?.focus();
            }}
          >
            {menu.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="desktop-titlebar-error">
          {error}
        </p>
      )}
    </header>
  );
}

/** 网页调试不伪造系统窗口栏；原生窗口按钮由 Electron titleBarOverlay 提供。 */
export function DesktopTitleBar() {
  const bridge = desktopChrome();
  return bridge ? <TitleBar bridge={bridge} /> : null;
}
