import type { Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { MAX_EDITABLE_FILE_BYTES, SyncSettingsSchema, type SyncSettings, type Workspace } from '@ssh-server/shared';
import { excludedPath, safeRelativePath } from '../sync/filters';
import { WorkspaceFileError } from './errors';

type DirectorySnapshot = { path: string; stat: Stats };
export type FileLocation = {
  absolute: string;
  relative: string;
  maxBytes: number;
  settings: SyncSettings;
  directories: DirectorySnapshot[];
};

export function sameIdentity(before: Stats, after: Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.birthtimeMs === after.birthtimeMs;
}

export function assertAllowedPath(relative: string, settings: SyncSettings): void {
  try {
    safeRelativePath(relative);
  } catch {
    throw new WorkspaceFileError('unsafe_path');
  }
  const parts = relative.split('/');
  if (
    relative.length > 4096 ||
    /\p{Cc}/u.test(relative) ||
    parts.some((part) => /^(conin\$|conout\$|com[¹²³]|lpt[¹²³])(?:\.|$)/i.test(part))
  ) {
    throw new WorkspaceFileError('unsafe_path');
  }
  for (let index = 1; index <= parts.length; index++) {
    if (excludedPath(parts.slice(0, index).join('/'), settings)) throw new WorkspaceFileError('excluded');
  }
}

async function inspectDirectories(directory: string): Promise<DirectorySnapshot[]> {
  const root = path.parse(directory).root;
  const paths = [root];
  for (const part of directory.slice(root.length).split(path.sep).filter(Boolean)) {
    paths.push(path.join(paths.at(-1)!, part));
  }
  const result: DirectorySnapshot[] = [];
  for (const current of paths) {
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new WorkspaceFileError('unsafe_path');
    result.push({ path: current, stat });
  }
  return result;
}

export async function assertDirectoriesUnchanged(location: FileLocation): Promise<void> {
  for (const entry of location.directories) {
    const current = await lstat(entry.path);
    if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(entry.stat, current)) {
      throw new WorkspaceFileError('unsafe_path');
    }
  }
}

export async function resolveWorkspacePath(
  ws: Workspace,
  relative: string,
  kind: 'file' | 'directory',
): Promise<FileLocation> {
  if (!path.isAbsolute(ws.localDir)) throw new WorkspaceFileError('unsafe_path');
  const settings = SyncSettingsSchema.parse(ws.sync ?? {});
  if (relative || kind === 'file') assertAllowedPath(relative, settings);
  const absolute = path.join(path.resolve(ws.localDir), ...relative.split('/'));
  const directories = await inspectDirectories(kind === 'directory' ? absolute : path.dirname(absolute));
  return {
    absolute,
    relative,
    settings,
    maxBytes: Math.min(MAX_EDITABLE_FILE_BYTES, settings.maxFileBytes),
    directories,
  };
}
