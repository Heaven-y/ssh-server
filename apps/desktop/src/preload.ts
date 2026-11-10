// 预加载脚本：只经 contextBridge 暴露窄接口，不暴露 ipcRenderer、require 或 Node 全局。
import { contextBridge, ipcRenderer } from 'electron';
import {
  APP_MENU_CHANNEL,
  INITIAL_SESSION_LINK_CHANNEL,
  SELECT_DIRECTORY_CHANNEL,
  SESSION_LINK_CHANNEL,
  TITLE_BAR_THEME_CHANNEL,
  type AgentDeckBridge,
  type AppMenuName,
  type AppMenuPosition,
} from './bridge';

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('agentDeck', {
    platform: process.platform,
    selectDirectory: (initialPath?: string) =>
      ipcRenderer.invoke(SELECT_DIRECTORY_CHANNEL, initialPath) as Promise<string | null>,
    chrome: {
      showMenu: (name: AppMenuName, position: AppMenuPosition) =>
        ipcRenderer.invoke(APP_MENU_CHANNEL, name, position) as Promise<void>,
      setTheme: (theme: 'light' | 'dark') => ipcRenderer.invoke(TITLE_BAR_THEME_CHANNEL, theme) as Promise<void>,
    },
    sessionLinks: {
      onOpen: (listener: (reference: string) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, reference: string) => listener(reference);
        ipcRenderer.on(SESSION_LINK_CHANNEL, handler);
        return () => ipcRenderer.removeListener(SESSION_LINK_CHANNEL, handler);
      },
      initial: () => ipcRenderer.invoke(INITIAL_SESSION_LINK_CHANNEL) as Promise<string | undefined>,
    },
  } satisfies AgentDeckBridge);
}
