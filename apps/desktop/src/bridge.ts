/** 预加载仅暴露桌面所需的具名能力，不把 IPC 通道交给页面。 */
export const SELECT_DIRECTORY_CHANNEL = 'agentdeck:select-directory';
export const APP_MENU_CHANNEL = 'agentdeck:app-menu';
export const TITLE_BAR_THEME_CHANNEL = 'agentdeck:title-bar-theme';

export type AppMenuName = 'file' | 'edit' | 'view' | 'window';
export type AppMenuPosition = { x: number; y: number };
export type DesktopChrome = {
  showMenu(name: AppMenuName, position: AppMenuPosition): Promise<void>;
  setTheme(theme: 'light' | 'dark'): Promise<void>;
};

export type AgentDeckBridge = {
  platform: string;
  selectDirectory(initialPath?: string): Promise<string | null>;
  chrome?: DesktopChrome;
};
