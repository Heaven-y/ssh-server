// 前后端共用的协议定义入口

/** 前后端协议版本，协议出现不兼容变化时递增 */
export const PROTOCOL_VERSION = 1;

export type { AgentEvent } from './events';
export { ClientMessageSchema } from './protocol';
export type { ClientMessage, ServerMessage } from './protocol';
export { WorkspaceInputSchema } from './workspace';
export type { SshHostInfo, Workspace, WorkspaceInput } from './workspace';
