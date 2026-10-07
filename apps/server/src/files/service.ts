import { lstat, opendir } from 'node:fs/promises';
import path from 'node:path';
import type {
  Workspace,
  WorkspaceDirectory,
  WorkspaceFile,
  WorkspaceFileEntry,
  WorkspaceFileInput,
} from '@ssh-server/shared';
import { fileOperation, WorkspaceFileError } from './errors';
import { decodeText, digest, encodeText, readSnapshot, replaceFile } from './io';
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

export function createWorkspaceFilesService() {
  const queues = new Map<string, Promise<unknown>>();
  function serialize<T>(ws: Workspace, operation: () => Promise<T>): Promise<T> {
    const directory = path.resolve(ws.localDir);
    const key = process.platform === 'win32' ? directory.toLowerCase() : directory;
    const run = (queues.get(key) ?? Promise.resolve()).then(operation, operation);
    queues.set(key, run);
    void run
      .finally(() => {
        if (queues.get(key) === run) queues.delete(key);
      })
      .catch(() => undefined);
    return run;
  }
  return {
    list(ws: Workspace, relativeDirectory = ''): Promise<WorkspaceDirectory> {
      return fileOperation(async () => listDirectory(await resolveWorkspacePath(ws, relativeDirectory, 'directory')));
    },
    read(ws: Workspace, relativeFile: string): Promise<WorkspaceFile> {
      return fileOperation(async () => {
        const location = await resolveWorkspacePath(ws, relativeFile, 'file');
        const snapshot = await readSnapshot(location);
        return {
          path: relativeFile,
          content: decodeText(snapshot.data),
          revision: snapshot.revision,
          size: snapshot.data.length,
        };
      });
    },
    revision(ws: Workspace, relativeFile: string): Promise<{ revision: string }> {
      return fileOperation(async () => {
        const location = await resolveWorkspacePath(ws, relativeFile, 'file');
        return { revision: (await readSnapshot(location)).revision };
      });
    },
    save(ws: Workspace, input: WorkspaceFileInput): Promise<WorkspaceFile> {
      return fileOperation(() =>
        serialize(ws, async () => {
          const location = await resolveWorkspacePath(ws, input.path, 'file');
          const data = encodeText(input.content, location.maxBytes);
          const before = await readSnapshot(location);
          if (before.revision !== input.revision) throw new WorkspaceFileError('revision_conflict');
          decodeText(before.data);
          await replaceFile(location, data, before);
          return { path: input.path, content: input.content, revision: digest(data), size: data.length };
        }),
      );
    },
  };
}

export type WorkspaceFilesService = ReturnType<typeof createWorkspaceFilesService>;
