// 预加载脚本：只经 contextBridge 暴露窄接口，不暴露 ipcRenderer、require 或 Node 全局。
// 将来需要系统对话框等能力时，在这里逐个加具名方法。
import { contextBridge } from 'electron';

/** 渲染层可见的桌面能力，保持只读且与浏览器环境可区分。 */
export type AgentDeckBridge = {
  platform: NodeJS.Platform;
};

contextBridge.exposeInMainWorld('agentDeck', {
  platform: process.platform,
} satisfies AgentDeckBridge);
