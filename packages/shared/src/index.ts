// 前后端共用的协议定义入口

/** 前后端协议版本，协议出现不兼容变化时递增 */
export const PROTOCOL_VERSION = 1;

export { RESOURCE_LIMITS } from './resources';
export type {
  ResourceGpu,
  ResourceProcess,
  ResourceHost,
  ResourceDisk,
  ResourceReading,
  ResourceSnapshot,
} from './resources';

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
export { SshAuthModeSchema, WorkspaceInputSchema } from './workspace';
export type { SshAuthMode, SshHostInfo, Workspace, WorkspaceInput } from './workspace';
export { SyncSettingsSchema, DEFAULT_EXCLUDED_EXTENSIONS } from './sync';
export type { SyncSettings, SyncConflict, SyncStatus } from './sync';
export type { NativeConfigAgent, NativeConfigDocument, NativeConfigInput } from './settings';
export { ProductSettingsSchema, ProductSettingsInputSchema, resourceTiming } from './product-settings';
export type {
  ProductSettings,
  ProductSettingsDocument,
  ProductSettingsInput,
  EnvironmentTool,
  EnvironmentReport,
  ResourceTiming,
} from './product-settings';
export { MAX_EDITABLE_FILE_BYTES } from './files';
export type { WorkspaceDirectory, WorkspaceFileEntry, WorkspaceFile, WorkspaceFileInput } from './files';
export { FileEditorMessageSchema } from './file-editors';
export type { FileEditorState, FileEditorMessage, FileEditorServerMessage } from './file-editors';
export type {
  RemoteBrowseTarget,
  RemoteBrowseSession,
  RemoteFileScope,
  RemoteFileEntry,
  RemoteDirectory,
  RemoteFileActionKind,
  RemoteFileActionInput,
  RemoteFilePreflight,
  RemoteFileTaskPhase,
  RemoteFileTask,
} from './remote-files';
export type {
  VersionChange,
  VersionExcluded,
  VersionStatus,
  VersionCommit,
  VersionHistory,
  VersionDiff,
  VersionSaveInput,
  VersionSaveResult,
  VersionRestoreInput,
  VersionRestorePreview,
  VersionRestoreResult,
} from './versions';
export { VERSION_MESSAGE_MAX_LENGTH } from './versions';
export { AgentKindSchema, NativeSessionIdSchema, SessionActionSchema } from './agents';
export {
  ManualServerInputSchema,
  ManagedServerSchema,
  HostTrustConfirmationSchema,
  WorkspaceSetupInputSchema,
  WorkspaceSetupCreateSchema,
} from './setup';
export type {
  ManualServerInput,
  ManagedServer,
  HostTrustStatus,
  HostTrustConfirmation,
  WorkspaceSetupCreate,
  LocalDirectory,
  SetupDirectoryInfo,
  WorkspaceSetupVerification,
  SetupInventory,
  WorkspaceSetupPreview,
  WorkspaceSetupResult,
} from './setup';
export type { AgentKind, SessionRef, SessionSummary, SessionHistory, SessionActionInput } from './agents';
export { WorkspaceRemovalInputSchema } from './workspace-removal';
export type {
  WorkspaceRemovalInput,
  WorkspaceRemovalBlocker,
  WorkspaceRemovalPreview,
  WorkspaceRemovalResult,
} from './workspace-removal';
export { CapabilitySelectionSchema } from './capabilities';
export type {
  CapabilitySelection,
  AgentCapabilities,
  AgentCapability,
  AgentModel,
  ContextUsage,
  CompactionState,
} from './capabilities';
