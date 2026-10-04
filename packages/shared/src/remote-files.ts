import type { SshAuthMode } from './workspace';

/** 面板打开时的配置快照；只用于绑定目标，不用于更新工作区。 */
export type RemoteBrowseTarget = {
  sshHost: string;
  authMode?: SshAuthMode;
  remoteDir: string;
  localDir: string;
};
export type RemoteBrowseSession = {
  id: string;
  workspaceId: string;
  sshHost: string;
  root: string;
  home: string;
};
export type RemoteFileScope = 'included' | 'excluded' | 'outside' | 'directory' | 'link' | 'unsupported';
export type RemoteFileEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'link' | 'other';
  size?: number;
  modifiedAt?: number;
  scope: RemoteFileScope;
};
export type RemoteDirectory = {
  path: string;
  root: string;
  outsideWorkspace: boolean;
  entries: RemoteFileEntry[];
  nextCursor?: string;
};

export type RemoteFileActionKind = 'mkdir' | 'rename' | 'move' | 'copy' | 'delete';
export type RemoteFileActionInput = { kind: RemoteFileActionKind; source?: string; destination?: string };
export type RemoteFilePreflight = RemoteFileActionInput & {
  id: string;
  workspaceId: string;
  sshHost: string;
  expiresAt: number;
  sourceType?: RemoteFileEntry['type'];
  entries: number;
  files: number;
  bytes: number;
  crossFilesystem: boolean;
  affectedWorkspaces: Array<{
    id: string;
    name: string;
    remoteRoot: string;
    sourceFiles?: number;
    destinationFiles?: number;
  }>;
  warnings: string[];
  canSubmit: boolean;
};
export type RemoteFileTaskPhase =
  | 'queued'
  | 'checking'
  | 'creating'
  | 'renaming'
  | 'copying'
  | 'verifying'
  | 'removing_source'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'needs_check'
  | 'sync_pending';
export type RemoteFileTask = RemoteFileActionInput & {
  id: string;
  workspaceId: string;
  preflightId: string;
  sshHost: string;
  phase: RemoteFileTaskPhase;
  createdAt: number;
  updatedAt: number;
  cancelRequested: boolean;
  message?: string;
  remoteCompleted: boolean;
  syncCompleted: boolean;
  syncRequired?: boolean;
  resultCheck?: { source?: { exists: boolean }; destination?: { exists: boolean } };
};
