/** 预加载仅暴露桌面所需的具名能力，不把 IPC 通道交给页面。 */
export const SELECT_DIRECTORY_CHANNEL = 'agentdeck:select-directory';

export type AgentDeckBridge = {
  platform: string;
  selectDirectory(initialPath?: string): Promise<string | null>;
};
