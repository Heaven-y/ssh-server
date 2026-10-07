import { randomUUID } from 'node:crypto';
import type { RemoteDirectory, SyncSettings } from '@ssh-server/shared';
import type { SftpReader } from '../ssh/sftp';
import { compareDirectoryEntries, createDirectoryBudget } from '../files/directory-order';
import { directoryEntry, inside } from './paths';
import { RemoteFilesError } from './errors';

export const DIRECTORY_IDLE_MS = 60_000;
const PAGE_SIZE = 200;

export function createDirectoryCursor(
  reader: SftpReader,
  handle: Buffer,
  { directory, root, settings }: { directory: string; root: string; settings: SyncSettings },
) {
  let closed = false;
  let expired = false;
  let snapshot: RemoteDirectory['entries'] | undefined;
  let offset = 0;
  let expected: string | undefined;
  let previous: { cursor: string | undefined; page: RemoteDirectory } | undefined;
  const releaseHandle = async () => {
    if (closed) return;
    closed = true;
    await reader.closeHandle(handle).catch(() => undefined);
  };
  const expire = () => {
    expired = true;
    snapshot = undefined;
    previous = undefined;
    reader.close();
    void releaseHandle();
  };
  let timer = setTimeout(expire, DIRECTORY_IDLE_MS);
  timer.unref();
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(expire, DIRECTORY_IDLE_MS);
    timer.unref();
  };
  async function collectDirectory(): Promise<RemoteDirectory['entries']> {
    const entries: RemoteDirectory['entries'] = [];
    const withinBudget = createDirectoryBudget();
    while (true) {
      reader.signal.throwIfAborted();
      const batch = await reader.readdir(handle);
      reader.signal.throwIfAborted();
      if (!batch || !batch.length) break;
      for (const item of batch) {
        const entry = directoryEntry(item, directory, root, settings);
        if (!withinBudget(entry ?? item.filename)) throw new RemoteFilesError('directory_too_large');
        if (entry) entries.push(entry);
      }
    }
    entries.sort(compareDirectoryEntries);
    await releaseHandle();
    reader.close();
    return entries;
  }
  async function ensureSnapshot() {
    try {
      snapshot ??= await collectDirectory();
      if (expired) throw new RemoteFilesError('cursor_expired');
      return snapshot;
    } catch (error) {
      expire();
      throw error instanceof RemoteFilesError ? error : new RemoteFilesError('cursor_expired');
    }
  }
  return {
    path: directory,
    async page(cursor?: string): Promise<RemoteDirectory> {
      if (expired) throw new RemoteFilesError('cursor_expired');
      if (previous && cursor === previous.cursor) {
        touch();
        return previous.page;
      }
      if (cursor !== expected || (previous && !expected)) throw new RemoteFilesError('cursor_expired');
      clearTimeout(timer);
      const current = await ensureSnapshot();
      const entries = current.slice(offset, offset + PAGE_SIZE);
      offset += entries.length;
      expected = offset < current.length ? randomUUID() : undefined;
      const page = { path: directory, root, outsideWorkspace: !inside(root, directory), entries, nextCursor: expected };
      previous = { cursor, page };
      if (!expected) snapshot = [];
      touch();
      return page;
    },
    async close() {
      clearTimeout(timer);
      expired = true;
      snapshot = undefined;
      previous = undefined;
      reader.close();
      await releaseHandle();
    },
  };
}

export type DirectoryCursor = ReturnType<typeof createDirectoryCursor>;
