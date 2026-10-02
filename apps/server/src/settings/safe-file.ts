import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { NativeConfigError } from './errors';

export const MAX_CONFIG_BYTES = 256 * 1024;
type DirectoryEntry = { path: string; stat: Stats };
type FileSnapshot = { content: string; revision: string; stat?: Stats };

export const contentRevision = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

async function statIfPresent(file: string): Promise<Stats | undefined> {
  try {
    return await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeMs === right.birthtimeMs;
}

function assertOrdinaryFile(stat: Stats) {
  if (stat.isSymbolicLink() || !stat.isFile()) throw new NativeConfigError('unsafe_path');
  if (stat.size > MAX_CONFIG_BYTES) throw new NativeConfigError('too_large');
}

// 逐层检查后创建，避免 recursive mkdir 顺着已有链接写入其他位置。
export async function inspectDirectory(directory: string, create = false): Promise<DirectoryEntry[] | undefined> {
  const root = path.parse(directory).root;
  const parts = directory.slice(root.length).split(path.sep).filter(Boolean);
  const directories = [root];
  for (const part of parts) directories.push(path.join(directories.at(-1)!, part));
  const entries: DirectoryEntry[] = [];
  for (const current of directories) {
    let stat = await statIfPresent(current);
    if (!stat && !create) return undefined;
    if (!stat) {
      await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      stat = await lstat(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new NativeConfigError('unsafe_path');
    entries.push({ path: current, stat });
  }
  return entries;
}

export async function assertDirectoryUnchanged(entries: DirectoryEntry[]): Promise<void> {
  for (const entry of entries) {
    const stat = await statIfPresent(entry.path);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory() || !sameIdentity(entry.stat, stat)) {
      throw new NativeConfigError('unsafe_path');
    }
  }
}

async function readBounded(handle: FileHandle): Promise<Buffer> {
  const data = Buffer.alloc(MAX_CONFIG_BYTES + 1);
  let length = 0;
  while (length < data.length) {
    const { bytesRead } = await handle.read(data, length, data.length - length, length);
    if (!bytesRead) break;
    length += bytesRead;
  }
  if (length > MAX_CONFIG_BYTES) throw new NativeConfigError('too_large');
  return data.subarray(0, length);
}

export function decodeUtf8(data: Uint8Array): string {
  try {
    // 保留 BOM，解析时可忽略，但返回与落盘内容不能被重新格式化。
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    throw new NativeConfigError('invalid_utf8');
  }
}

function assertFileUnchanged(before: Stats, after: Stats) {
  assertOrdinaryFile(after);
  if (
    !sameIdentity(before, after) ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    throw new NativeConfigError('revision_conflict');
  }
}

export async function readConfigFile(file: string): Promise<FileSnapshot> {
  const before = await statIfPresent(file);
  if (!before) return { content: '', revision: 'missing' };
  assertOrdinaryFile(before);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    assertFileUnchanged(before, await handle.stat());
    const data = await readBounded(handle);
    assertFileUnchanged(before, await handle.stat());
    const after = await statIfPresent(file);
    if (!after) throw new NativeConfigError('revision_conflict');
    assertFileUnchanged(before, after);
    return { content: decodeUtf8(data), revision: contentRevision(data), stat: after };
  } finally {
    await handle.close();
  }
}

export async function writeConfigFile(
  file: string,
  data: Buffer,
  previous: FileSnapshot,
  directory: DirectoryEntry[],
): Promise<void> {
  const temporary = path.join(path.dirname(file), `.config-${randomUUID()}.tmp`);
  let temporaryStat: Stats | undefined;
  try {
    await assertDirectoryUnchanged(directory);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      temporaryStat = await handle.stat();
      await handle.writeFile(data);
      await handle.sync();
      temporaryStat = await handle.stat();
    } finally {
      await handle.close();
    }
    await assertDirectoryUnchanged(directory);
    const current = await readConfigFile(file);
    if (
      current.revision !== previous.revision ||
      (previous.stat && (!current.stat || !sameIdentity(previous.stat, current.stat)))
    ) {
      throw new NativeConfigError('revision_conflict');
    }
    const pending = await lstat(temporary);
    assertFileUnchanged(temporaryStat, pending);
    // Node 未暴露跨平台 openat；在原子替换前再次核对目录身份和摘要。
    await assertDirectoryUnchanged(directory);
    await rename(temporary, file);
    temporaryStat = undefined;
  } finally {
    // 仅清理本次创建且仍在同一安全目录内的临时文件。
    if (temporaryStat) {
      await assertDirectoryUnchanged(directory);
      const remaining = await statIfPresent(temporary);
      if (remaining && sameIdentity(temporaryStat, remaining)) await unlink(temporary);
    }
  }
}
