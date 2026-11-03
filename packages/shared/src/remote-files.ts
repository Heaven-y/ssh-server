import { z } from 'zod';

/**
 * 文件浏览里「同步范围」标记的判定参数。
 * 同步域已删除，这两个值只剩默认值；标记本身（included / excluded）保留，
 * 行为与删除前完全一致，是否下线该标记由文件浏览的重做决定。
 */
export const DEFAULT_EXCLUDED_EXTENSIONS = [
  'pkl',
  'pickle',
  'pt',
  'pth',
  'ckpt',
  'safetensors',
  'joblib',
  'npy',
  'npz',
  'rdata',
  'rds',
  'h5',
  'hdf5',
  'parquet',
  'arrow',
  'zip',
  'gz',
  'bz2',
  'xz',
  'tar',
  '7z',
  'rar',
];
export const RemoteFileFilterSchema = z.object({
  maxFileBytes: z
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  excludedExtensions: z
    .array(z.string().regex(/^[a-zA-Z0-9]{1,20}$/))
    .max(100)
    .default(DEFAULT_EXCLUDED_EXTENSIONS)
    .transform((items) => [...new Set(items.map((item) => item.toLowerCase()))].sort()),
});
export type RemoteFileFilter = z.infer<typeof RemoteFileFilterSchema>;

/** 面板打开时的配置快照；只用于绑定目标，不用于更新工作区。 */
export type RemoteBrowseTarget = {
  /** 服务器档案别名 */
  sshHost: string;
  remoteDir: string;
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
  syncRequired: boolean;
  resultCheck?: { source?: { exists: boolean }; destination?: { exists: boolean } };
};
