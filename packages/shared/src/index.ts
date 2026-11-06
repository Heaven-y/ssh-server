// 前后端共用的协议定义入口

/** 前后端协议版本，协议出现不兼容变化时递增 */
export const PROTOCOL_VERSION = 1;
export * from './plugins';
export * from './ssh-console';

export { RESOURCE_LIMITS } from './resources';
export type {
  ResourceGpu,
  ResourceProcess,
  ResourceHost,
  ResourceDisk,
  ResourceReading,
  ResourceSnapshot,
} from './resources';

export type { SlurmSnapshot } from './slurm';

export {
  TERMINAL_LIMITS,
  TerminalTargetSchema,
  TerminalSizeSchema,
  TerminalTokenSchema,
  TerminalBindingRequestSchema,
  TerminalBindingSchema,
  TerminalClientMessageSchema,
  TerminalServerMessageSchema,
  workspaceTerminalTarget,
  terminalTargetKey,
} from './terminal';
export type {
  TerminalTarget,
  TerminalSize,
  TerminalBinding,
  TerminalClientMessage,
  TerminalServerMessage,
} from './terminal';

export type { AgentEvent } from './events';
export { ClientMessageSchema } from './protocol';
export type { ClientMessage, ServerMessage } from './protocol';
export { SshAuthModeSchema, WorkspaceInputSchema, WorkspaceSchema, isBoundWorkspace } from './workspace';
export type { BoundWorkspace, SshAuthMode, SshHostInfo, Workspace, WorkspaceInput } from './workspace';
export { DEFAULT_EXCLUDED_EXTENSIONS, RemoteFileFilterSchema } from './remote-files';
export type {
  RemoteBrowseTarget,
  RemoteBrowseSession,
  RemoteFileFilter,
  RemoteFileScope,
  RemoteFileEntry,
  RemoteDirectory,
  RemoteFileActionKind,
  RemoteFileActionInput,
  RemoteFilePreflight,
  RemoteFileTaskPhase,
  RemoteFileTask,
} from './remote-files';
export type { NativeConfigAgent, NativeConfigDocument, NativeConfigInput } from './settings';
export type {
  NativeResource,
  NativeResourceKind,
  NativeResourceScope,
  NativeResourceFormat,
  NativeResourceRoot,
  NativeResourceGuidance,
  NativeResourceCatalog,
  NativeResourceDocument,
  NativeResourceSaveInput,
  NativeResourceCreateInput,
  NativeResourceSaved,
} from './native-resources';
export { LaunchEnvironmentInputSchema, LaunchVariableModeSchema } from './launch-environment';
export type { LaunchEnvironmentInput, LaunchEnvironmentDocument, LaunchVariableMode } from './launch-environment';
export { ProductSettingsSchema, ProductSettingsInputSchema, resourceTiming } from './product-settings';
export type {
  ProductSettings,
  ProductSettingsDocument,
  ProductSettingsInput,
  EnvironmentTool,
  EnvironmentReport,
  ResourceTiming,
} from './product-settings';
export { AgentKindSchema, NativeSessionIdSchema, SessionActionSchema, SessionForkSchema } from './agents';
export { ManualServerInputSchema, ManagedServerSchema, HostTrustConfirmationSchema } from './setup';
export type { ManualServerInput, ManagedServer, HostTrustStatus, HostTrustConfirmation } from './setup';
export type { AgentKind, SessionActionInput, SessionForkInput } from './agents';
export {
  AgentProbeSchema,
  ProbeStatusSchema,
  SessionSummarySchema,
  SessionCapabilitiesSchema,
  nativeSessionCapabilities,
} from './session';
export type {
  AgentProbe,
  ProbeStatus,
  SessionHistory,
  SessionRecord,
  SessionRef,
  SessionSummary,
  SessionCapabilities,
} from './session';
export { CapabilitySelectionSchema } from './capabilities';
export type {
  CapabilitySelection,
  AgentCapabilities,
  AgentCapability,
  AgentModel,
  ContextUsage,
  CompactionState,
  TokenUsage,
} from './capabilities';
export * from './model-settings';
