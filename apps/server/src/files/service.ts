import { lstat, opendir } from 'node:fs/promises';
import path from 'node:path';
import type { Workspace, WorkspaceDirectory, WorkspaceFile, WorkspaceFileEntry } from '@ssh-server/shared';
import { readFileSafely, WorkspaceFileError } from './errors';
import { decodeText, readSnapshot } from './io';
import { assertAllowedPath, assertDirectoriesUnchanged, resolveWorkspacePath, type FileLocation } from './paths';
import { compareDirectoryEntries } from './directory-order';

export const MAX_DIRECTORY_ENTRIES = 500;
const MAX_SCANNED_ENTRIES = 5000;

async function directoryEntry(location: FileLocation, name: string): Promise<WorkspaceFileEntry | undefined> {
  const relative = location.relative ? `${location.relative}/${name}` : name;
  try {
    assertAllowedPath(relative, location.settings);
  } catch (error) {
    if (error instanceof WorkspaceFileError) return undefined;
    throw error;
  }
  const stat = await lstat(path.join(location.absolute, name)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (!stat || stat.isSymbolicLink()) return undefined;
  if (stat.isDirectory()) return { path: relative, name, kind: 'directory' };
  if (stat.isFile() && stat.size <= location.maxBytes) return { path: relative, name, kind: 'file', size: stat.size };
  return undefined;
}

async function listDirectory(location: FileLocation): Promise<WorkspaceDirectory> {
  const entries: WorkspaceFileEntry[] = [];
  let scanned = 0;
  let truncated = false;
  const directory = await opendir(location.absolute);
  // opendir 逐批读取；既限制返回数量，也限制被排除项很多时的扫描工作量。
  for await (const item of directory) {
    if (++scanned > MAX_SCANNED_ENTRIES) {
      truncated = true;
      break;
    }
    const entry = await directoryEntry(location, item.name);
    if (!entry) continue;
    entries.push(entry);
  }
  await assertDirectoriesUnchanged(location);
  entries.sort(compareDirectoryEntries);
  return {
    path: location.relative,
    entries: entries.slice(0, MAX_DIRECTORY_ENTRIES),
    truncated: truncated || entries.length > MAX_DIRECTORY_ENTRIES,
  };
}

/** 本地工作区文件只读：网页只查看列表与正文，改动交给 Agent、同步流程或外部编辑器。 */
export function createWorkspaceFilesService() {
  return {
    list(ws: Workspace, relativeDirectory = ''): Promise<WorkspaceDirectory> {
      return readFileSafely(async () => listDirectory(await resolveWorkspacePath(ws, relativeDirectory, 'directory')));
    },
    read(ws: Workspace, relativeFile: string): Promise<WorkspaceFile> {
      return readFileSafely(async () => {
        const location = await resolveWorkspacePath(ws, relativeFile, 'file');
        const snapshot = await readSnapshot(location);
        return { path: relativeFile, content: decodeText(snapshot.data), size: snapshot.data.length };
      });
    },
  };
}

export type WorkspaceFilesService = ReturnType<typeof createWorkspaceFilesService>;
