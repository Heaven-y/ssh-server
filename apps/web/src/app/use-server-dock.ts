import { useState } from 'react';
import { useUiPreferences } from '../ui/ui-preferences';
import type { ServerDockView } from './ServerDock';
import { useMinWidth } from './use-min-width';

/**
 * 右侧服务器面板的展开、当前视图与已挂载视图。
 * 展开状态是持久偏好；还没表过态时 ≥1280px 首屏展开、窄窗不强开。
 * 窄窗主动展开左栏时面板让位，避免三段互相挤压（ui-layout 1.1）。
 */
export function useServerDock() {
  const wide = useMinWidth(1280);
  const choice = useUiPreferences((state) => state.dockCollapsed);
  const sidebarHidden = useUiPreferences((state) => state.sidebarCollapsed || state.sidebarAutoCollapsed);
  const [view, setView] = useState<ServerDockView>('resources');
  // 终端与文件按需挂载：不开就不建 PTY、不发绑定请求；挂上后收起或切视图都不卸载。
  const [loaded, setLoaded] = useState<ReadonlySet<ServerDockView>>(() => new Set<ServerDockView>(['resources']));
  const stored = choice ?? !wide;
  const open = (wide || sidebarHidden) && !stored;
  const setOpen = (value: boolean) => useUiPreferences.getState().setDockCollapsed(!value);
  const select = (next: ServerDockView) => {
    setLoaded((previous) => (previous.has(next) ? previous : new Set(previous).add(next)));
    setView(next);
  };
  // 窄窗下要开面板，先把左栏让开；只改内存里的自动收起，不覆盖用户记住的偏好。
  const reveal = (next: ServerDockView) => {
    if (!wide) useUiPreferences.getState().setSidebarAutoCollapsed(true);
    select(next);
    setOpen(true);
  };
  return { open, view, loaded, select, reveal, hide: () => setOpen(false) };
}
