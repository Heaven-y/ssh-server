import type { AgentDeckBridge } from '../../../desktop/src/bridge';

declare global {
  interface Window {
    agentDeck?: AgentDeckBridge;
  }
}

/** 浏览器调试以及旧桌面壳没有该能力时，继续使用路径输入。 */
export function desktopDirectoryPicker() {
  return window.agentDeck?.selectDirectory;
}

export function desktopChrome() {
  return window.agentDeck?.chrome;
}
