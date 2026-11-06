import { constants, type Dirent, type Stats } from 'node:fs';
import { lstat, open, opendir, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { assertDirectoryUnchanged, inspectDirectory } from '../platform/files/safe-file';
import { WorkbenchPluginError } from './errors';

export const MAX_PLUGIN_BYTES = 10 * 1024 * 1024;
export const MAX_PLUGIN_FILES = 256;
export const MAX_PLUGIN_STORAGE_BYTES = 64 * 1024;

export function safeRelative(relative: string): boolean {
  if (!relative || relative.length > 240 || relative.includes('\\') || path.posix.isAbsolute(relative)) return false;
  return relative
    .split('/')
    .every(
      (part) =>
        !!part &&
        part !== '.' &&
        part !== '..' &&
        !/[<>:"|?*]/.test(part) &&
        !/[. ]$/.test(part) &&
        ![...part].some((character) => character.charCodeAt(0) < 32) &&
        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    );
}

export function childPath(root: string, relative: string): string {
  if (!safeRelative(relative)) throw new WorkbenchPluginError('unsafe_path');
  const resolved = path.resolve(root, relative);
  const inside = path.relative(path.resolve(root), resolved);
  if (!inside || inside.startsWith(`..${path.sep}`) || inside === '..' || path.isAbsolute(inside))
    throw new WorkbenchPluginError('unsafe_path');
  return resolved;
}

export async function statIfPresent(file: string): Promise<Stats | undefined> {
  return lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
}

function sameFile(before: Stats, after: Stats): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.birthtimeMs === after.birthtimeMs &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

function ordinaryFile(stat: Stats | undefined, limit: number): Stats {
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new WorkbenchPluginError('unsafe_path');
  if (stat.size > limit) throw new WorkbenchPluginError('too_large');
  return stat;
}
function unchangedFile(before: Stats, after: Stats | undefined) {
  if (!after || !sameFile(before, after)) throw new WorkbenchPluginError('unsafe_path');
}
async function boundedBytes(handle: FileHandle, limit: number): Promise<Buffer> {
  const bytes = Buffer.alloc(limit + 1);
  let length = 0;
  while (length < bytes.length) {
    const result = await handle.read(bytes, length, bytes.length - length, length);
    if (!result.bytesRead) break;
    length += result.bytesRead;
  }
  if (length > limit) throw new WorkbenchPluginError('too_large');
  return bytes.subarray(0, length);
}

export async function readPluginFile(file: string, limit = MAX_PLUGIN_BYTES): Promise<Buffer> {
  const parents = await inspectDirectory(path.dirname(file));
  const before = ordinaryFile(parents ? await statIfPresent(file) : undefined, limit);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    unchangedFile(before, await handle.stat());
    // 只按已核实的文件长度分配，避免多个小文件各自保留整包上限的缓冲。
    const bytes = await boundedBytes(handle, Math.min(limit, before.size));
    unchangedFile(before, await statIfPresent(file));
    unchangedFile(before, await handle.stat());
    await assertDirectoryUnchanged(parents!);
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function enumeratePluginFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  let directories = 0;
  async function visitEntry(entry: Dirent, relative: string, depth: number) {
    if (entry.isSymbolicLink() || !safeRelative(relative)) throw new WorkbenchPluginError('unsafe_path');
    if (entry.isDirectory()) await visit(childPath(root, relative), relative, depth + 1);
    else if (entry.isFile()) {
      files.push(relative);
      if (files.length > MAX_PLUGIN_FILES) throw new WorkbenchPluginError('too_large');
    } else throw new WorkbenchPluginError('unsafe_path');
  }
  async function visit(directory: string, prefix = '', depth = 0): Promise<void> {
    if (++directories > MAX_PLUGIN_FILES || depth > 8) throw new WorkbenchPluginError('too_large');
    const parents = await inspectDirectory(directory);
    if (!parents) throw new WorkbenchPluginError('unsafe_path');
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      await visitEntry(entry, relative, depth);
    }
    await assertDirectoryUnchanged(parents);
  }
  await visit(root);
  return files;
}

function expectedDirectory(before: Stats, expected?: Stats) {
  if (
    expected &&
    (before.dev !== expected.dev || before.ino !== expected.ino || before.birthtimeMs !== expected.birthtimeMs)
  )
    throw new WorkbenchPluginError('unsafe_path');
}

/** 删除前先完整检查本插件目录；不跟随链接，也不对客户端给出的路径递归删除。 */
export async function removePluginDirectory(root: string, expected?: Stats): Promise<void> {
  const before = await statIfPresent(root);
  if (!before) return;
  expectedDirectory(before, expected);
  const parents = await inspectDirectory(root);
  if (!parents) return;
  const files = await enumeratePluginFiles(root);
  for (const relative of files) {
    await assertDirectoryUnchanged(parents);
    const file = childPath(root, relative);
    const directories = await inspectDirectory(path.dirname(file));
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new WorkbenchPluginError('unsafe_path');
    if (directories) await assertDirectoryUnchanged(directories);
    await unlink(file);
  }
  let emptied = 0;
  async function empty(directory: string, depth = 0): Promise<void> {
    if (++emptied > MAX_PLUGIN_FILES || depth > 8) throw new WorkbenchPluginError('too_large');
    const directories = await inspectDirectory(directory);
    if (!directories) throw new WorkbenchPluginError('unsafe_path');
    const handle = await opendir(directory);
    for await (const entry of handle) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new WorkbenchPluginError('unsafe_path');
      await empty(childPath(directory, entry.name), depth + 1);
    }
    await assertDirectoryUnchanged(directories);
    await rmdir(directory);
  }
  await assertDirectoryUnchanged(parents);
  await empty(root);
}
