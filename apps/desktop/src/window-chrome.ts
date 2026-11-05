import type { BrowserWindow, BrowserWindowConstructorOptions, MenuItemConstructorOptions } from 'electron';
import type { AppMenuName, AppMenuPosition } from './bridge';
import { desktopRequestAllowed, type DesktopOwner, type DesktopRequest } from './window-access';

export const TITLE_BAR_HEIGHT = 40;
const MENU_NAMES = new Set<AppMenuName>(['file', 'edit', 'view', 'window']);
const TITLE_BAR_COLORS = {
  light: { color: '#f9fafb', symbolColor: '#0f1115' },
  dark: { color: '#1b1b1c', symbolColor: '#f9fafb' },
};

/** 沿用 DSH 的 hidden 标题栏与原生窗口按钮；不自行实现关闭、最大化等系统行为。 */
export function desktopChromeOptions(platform = process.platform): BrowserWindowConstructorOptions {
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 12 } };
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...TITLE_BAR_COLORS.light, height: TITLE_BAR_HEIGHT },
    autoHideMenuBar: false,
  };
}

/** 由 Electron role 提供原生编辑、缩放、全屏及窗口快捷键。 */
export function applicationMenuTemplate(platform = process.platform): MenuItemConstructorOptions[] {
  return [
    ...(platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { id: 'file', role: 'fileMenu', label: 'File' },
    { id: 'edit', role: 'editMenu', label: 'Edit' },
    { id: 'view', role: 'viewMenu', label: 'View' },
    { id: 'window', role: 'windowMenu', label: 'Window' },
  ];
}

type ChromeOwner = DesktopOwner &
  Pick<BrowserWindow, 'getContentBounds' | 'setTitleBarOverlay'> & {
    webContents: DesktopOwner['webContents'] & Pick<BrowserWindow['webContents'], 'getZoomFactor'>;
  };
type Popup = (name: AppMenuName, position: AppMenuPosition) => Promise<void>;

function menuPosition(owner: ChromeOwner, input: unknown): AppMenuPosition {
  if (!input || typeof input !== 'object') throw new Error('菜单位置无效。');
  const { x, y } = input as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y))
    throw new Error('菜单位置无效。');
  const zoom = owner.webContents.getZoomFactor();
  const bounds = owner.getContentBounds();
  return {
    x: Math.round(Math.max(0, Math.min(bounds.width, x * zoom))),
    y: Math.round(Math.max(0, Math.min(bounds.height, y * zoom))),
  };
}

export function createWindowChrome(owner: ChromeOwner, initialUrl: string, popup: Popup, platform = process.platform) {
  let pending = false;
  const requireMainPage = (request: DesktopRequest) => {
    if (!desktopRequestAllowed(owner, initialUrl, request)) throw new Error('当前页面不能操作应用菜单。');
  };
  return {
    async showMenu(this: void, request: DesktopRequest, name: unknown, position: unknown): Promise<void> {
      requireMainPage(request);
      if (!MENU_NAMES.has(name as AppMenuName)) throw new Error('应用菜单不存在。');
      const point = menuPosition(owner, position);
      if (pending) return;
      pending = true;
      try {
        await popup(name as AppMenuName, point);
      } finally {
        pending = false;
      }
    },
    setTheme(this: void, request: DesktopRequest, theme: unknown): void {
      requireMainPage(request);
      if (theme !== 'light' && theme !== 'dark') throw new Error('标题栏主题无效。');
      if (platform !== 'darwin') owner.setTitleBarOverlay(TITLE_BAR_COLORS[theme]);
    },
  };
}
