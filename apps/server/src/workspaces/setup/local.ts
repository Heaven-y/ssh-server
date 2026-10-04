import { randomUUID } from 'node:crypto';
import { constants, type Dir, type Dirent } from 'node:fs';
import { access, lstat, opendir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LocalDirectory, SetupDirectoryInfo } from '@ssh-server/shared';
import { WorkspaceSetupError } from './errors';

const invalid = () =>
  new WorkspaceSetupError('local_directory_invalid', '本地同步根必须是可读写的普通绝对目录，且不能经过符号链接');
export async function inspectLocalRoot(input: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!path.isAbsolute(input)) throw invalid();
  const root = path.resolve(input);
  let ancestor = root;
  while (true) {
    const stat = await lstat(ancestor);
    signal.throwIfAborted();
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalid();
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  await access(root, constants.R_OK | constants.W_OK);
  const canonical = await realpath(root);
  const stat = await lstat(canonical);
  const directory = await opendir(canonical);
  let empty: boolean;
  try {
    empty = (await directory.read()) === null;
  } finally {
    await directory.close();
  }
  const git = await lstat(path.join(canonical, '.git')).then(
    () => true,
    () => false,
  );
  signal.throwIfAborted();
  const info: SetupDirectoryInfo = { path: canonical, empty, git };
  return { info, identity: JSON.stringify([canonical, stat.dev, stat.ino, stat.birthtimeMs]) };
}
const entryType = (entry: Dirent): LocalDirectory['entries'][number]['type'] => {
  if (entry.isSymbolicLink()) return 'link';
  if (entry.isDirectory()) return 'directory';
  return entry.isFile() ? 'file' : 'other';
};
type Cursor = { directory: Dir; path: string; signature: string; next?: Dirent; expiresAt: number };

export function createLocalDirectoryBrowser() {
  const cursors = new Map<string, Cursor>();
  let opening = 0;
  async function close(cursor: Cursor) {
    await cursor.directory.close().catch(() => undefined);
  }
  const timer = setInterval(() => {
    for (const [id, cursor] of cursors)
      if (cursor.expiresAt <= Date.now()) {
        cursors.delete(id);
        void close(cursor);
      }
  }, 60000);
  timer.unref();
  async function roots() {
    if (process.platform !== 'win32') return [os.homedir(), '/'];
    const drives = await Promise.all(
      Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index) + ':\\').map(async (drive) =>
        (await access(drive).then(
          () => true,
          () => false,
        ))
          ? drive
          : undefined,
      ),
    );
    return [os.homedir(), ...drives.filter((drive): drive is string => Boolean(drive))];
  }
  async function signature(directory: string) {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalid();
    return JSON.stringify([stat.dev, stat.ino, stat.mtimeMs]);
  }
  async function takeCursor(
    input: { cursor?: string },
    directoryPath: string,
    currentSignature: string,
  ): Promise<Cursor> {
    if (input.cursor) {
      const prior = cursors.get(input.cursor);
      cursors.delete(input.cursor);
      if (!prior) throw new WorkspaceSetupError('local_cursor_expired', '本地目录分页已失效，请重新浏览');
      opening++;
      return prior;
    }
    if (cursors.size + opening >= 32)
      throw new WorkspaceSetupError('local_cursor_full', '本地目录浏览数量已满，请稍后重试');
    opening++;
    try {
      return {
        directory: await opendir(directoryPath),
        path: directoryPath,
        signature: currentSignature,
        expiresAt: 0,
      };
    } catch (error) {
      opening--;
      throw error;
    }
  }
  async function readPage(cursor: Cursor, signal: AbortSignal) {
    const entries: LocalDirectory['entries'] = [];
    while (entries.length < 200) {
      signal.throwIfAborted();
      const entry = cursor.next ?? (await cursor.directory.read());
      cursor.next = undefined;
      if (!entry) break;
      entries.push({ name: entry.name, path: path.join(cursor.path, entry.name), type: entryType(entry) });
    }
    cursor.next = (await cursor.directory.read()) ?? undefined;
    return entries;
  }
  return {
    async list(input: { path?: string; cursor?: string }, signal: AbortSignal): Promise<LocalDirectory> {
      signal.throwIfAborted();
      const directoryPath = path.resolve(input.path ?? os.homedir());
      const currentSignature = await signature(directoryPath);
      const cursor = await takeCursor(input, directoryPath, currentSignature);
      try {
        if (cursor.path !== directoryPath || cursor.signature !== currentSignature)
          throw new WorkspaceSetupError('local_cursor_expired', '目录已变化，请重新浏览');
        const entries = await readPage(cursor, signal);
        signal.throwIfAborted();
        const result: LocalDirectory = {
          path: directoryPath,
          parent: path.dirname(directoryPath),
          roots: await roots(),
          entries,
        };
        signal.throwIfAborted();
        if (cursor.next) {
          result.nextCursor = randomUUID();
          cursor.expiresAt = Date.now() + 15 * 60000;
          cursors.set(result.nextCursor, cursor);
        } else await close(cursor);
        return result;
      } catch (error) {
        await close(cursor);
        throw error;
      } finally {
        opening--;
      }
    },
    async close(id: string) {
      const cursor = cursors.get(id);
      cursors.delete(id);
      if (cursor) await close(cursor);
    },
    async dispose() {
      clearInterval(timer);
      await Promise.all([...cursors.values()].map(close));
      cursors.clear();
    },
  };
}
