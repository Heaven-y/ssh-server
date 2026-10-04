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
