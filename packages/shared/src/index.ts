// 前后端共用的协议定义入口

/** 前后端协议版本，协议出现不兼容变化时递增 */
export const PROTOCOL_VERSION = 1;

export type { AgentEvent } from './events';
export { ClientMessageSchema } from './protocol';
export type { ClientMessage, ServerMessage } from './protocol';
export { SshAuthModeSchema, WorkspaceInputSchema } from './workspace';
export type { SshAuthMode, SshHostInfo, Workspace, WorkspaceInput } from './workspace';
export { SyncSettingsSchema, DEFAULT_EXCLUDED_EXTENSIONS } from './sync';
export type { SyncSettings, SyncConflict, SyncStatus } from './sync';
export type { NativeConfigAgent, NativeConfigDocument, NativeConfigInput } from './settings';
