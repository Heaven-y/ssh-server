// 预加载脚本：只经 contextBridge 暴露窄接口，不暴露 ipcRenderer、require 或 Node 全局。
import { contextBridge, ipcRenderer } from 'electron';
import { SELECT_DIRECTORY_CHANNEL, type AgentDeckBridge } from './bridge';

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('agentDeck', {
    platform: process.platform,
    selectDirectory: (initialPath?: string) =>
      ipcRenderer.invoke(SELECT_DIRECTORY_CHANNEL, initialPath) as Promise<string | null>,
  } satisfies AgentDeckBridge);
}
