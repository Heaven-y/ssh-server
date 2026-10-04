import { randomUUID } from 'node:crypto';
import type { FileEntryWithStats } from 'ssh2';
import type { RemoteDirectory, SyncSettings } from '@ssh-server/shared';
import type { SftpReader } from '../ssh/sftp';
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
  let eof = false;
  let buffered: FileEntryWithStats[] = [];
  let expected: string | undefined;
  let previous: { cursor: string | undefined; page: RemoteDirectory } | undefined;
  const releaseHandle = async () => {
    if (closed) return;
    closed = true;
    await reader.closeHandle(handle).catch(() => undefined);
  };
  const expire = () => {
    expired = true;
    buffered = [];
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
  async function collectPage(): Promise<RemoteDirectory['entries']> {
    const entries: RemoteDirectory['entries'] = [];
    while (entries.length < PAGE_SIZE && !eof) {
      if (!buffered.length) {
        const batch = await reader.readdir(handle);
        if (!batch || !batch.length) {
          eof = true;
          break;
        }
        buffered = batch;
      }
      while (buffered.length && entries.length < PAGE_SIZE) {
        const entry = directoryEntry(buffered.shift()!, directory, root, settings);
        if (entry) entries.push(entry);
      }
    }
    return entries;
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
      let entries: RemoteDirectory['entries'];
      try {
        entries = await collectPage();
      } catch {
        expire();
        throw new RemoteFilesError('cursor_expired');
      }
      expected = eof ? undefined : randomUUID();
      const page = { path: directory, root, outsideWorkspace: !inside(root, directory), entries, nextCursor: expected };
      previous = { cursor, page };
      if (eof) {
        await releaseHandle();
        reader.close();
      }
      touch();
      return page;
    },
    async close() {
      clearTimeout(timer);
      expired = true;
      buffered = [];
      previous = undefined;
      reader.close();
      await releaseHandle();
    },
  };
}

export type DirectoryCursor = ReturnType<typeof createDirectoryCursor>;
