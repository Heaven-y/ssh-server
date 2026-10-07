import { randomUUID } from 'node:crypto';
import { constants, type Dirent } from 'node:fs';
import { access, lstat, opendir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LocalDirectory, SetupDirectoryInfo } from '@ssh-server/shared';
import { WorkspaceSetupError } from './errors';
import { compareDirectoryEntries, createDirectoryBudget } from '../../files/directory-order';

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
type Cursor = { entries: LocalDirectory['entries']; path: string; signature: string; expiresAt: number };

async function directoryRoots() {
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

async function directorySignature(directory: string) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalid();
  return JSON.stringify([stat.dev, stat.ino, stat.mtimeMs]);
}

async function sortedDirectory(directoryPath: string, signal: AbortSignal) {
  const entries: LocalDirectory['entries'] = [];
  const withinBudget = createDirectoryBudget();
  const directory = await opendir(directoryPath);
  for await (const entry of directory) {
    signal.throwIfAborted();
    const item = { name: entry.name, path: path.join(directoryPath, entry.name), type: entryType(entry) };
    if (!withinBudget(item))
      throw new WorkspaceSetupError(
        'local_directory_too_large',
        '当前目录超过排序浏览上限（10000项或4 MiB元数据），请填写更具体的子目录路径',
      );
    entries.push(item);
  }
  signal.throwIfAborted();
  return entries.sort(compareDirectoryEntries);
}

export function createLocalDirectoryBrowser() {
  const cursors = new Map<string, Cursor>();
  const lifetime = new AbortController();
  let opening = 0;
  const timer = setInterval(() => {
    for (const [id, cursor] of cursors) if (cursor.expiresAt <= Date.now()) cursors.delete(id);
  }, 60000);
  timer.unref();
  async function takeCursor(
    input: { cursor?: string },
    directoryPath: string,
    signature: string,
    signal: AbortSignal,
  ): Promise<Cursor> {
    if (input.cursor) {
      const prior = cursors.get(input.cursor);
      cursors.delete(input.cursor);
      if (!prior || prior.expiresAt <= Date.now())
        throw new WorkspaceSetupError('local_cursor_expired', '本地目录分页已失效，请重新浏览');
      opening++;
      return prior;
    }
    if (cursors.size + opening >= 32)
      throw new WorkspaceSetupError('local_cursor_full', '本地目录浏览数量已满，请稍后重试');
    opening++;
    try {
      return { entries: await sortedDirectory(directoryPath, signal), path: directoryPath, signature, expiresAt: 0 };
    } catch (error) {
      opening--;
      throw error;
    }
  }
  return {
    async list(input: { path?: string; cursor?: string }, parent: AbortSignal): Promise<LocalDirectory> {
      const signal = AbortSignal.any([parent, lifetime.signal, AbortSignal.timeout(20_000)]);
      signal.throwIfAborted();
      const directoryPath = path.resolve(input.path ?? os.homedir());
      const signature = await directorySignature(directoryPath);
      const cursor = await takeCursor(input, directoryPath, signature, signal);
      try {
        if (cursor.path !== directoryPath || cursor.signature !== (await directorySignature(directoryPath)))
          throw new WorkspaceSetupError('local_cursor_expired', '目录已变化，请重新浏览');
        signal.throwIfAborted();
        const result: LocalDirectory = {
          path: directoryPath,
          parent: path.dirname(directoryPath),
          roots: await directoryRoots(),
          entries: cursor.entries.splice(0, 200),
        };
        signal.throwIfAborted();
        if (cursor.entries.length) {
          result.nextCursor = randomUUID();
          cursor.expiresAt = Date.now() + 15 * 60000;
          cursors.set(result.nextCursor, cursor);
        }
        return result;
      } finally {
        opening--;
      }
    },
    close(id: string) {
      cursors.delete(id);
      return Promise.resolve();
    },
    dispose() {
      lifetime.abort();
      clearInterval(timer);
      cursors.clear();
      return Promise.resolve();
    },
  };
}
