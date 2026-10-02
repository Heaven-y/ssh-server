import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceFileError } from './errors';
import { assertDirectoriesUnchanged, sameIdentity, type FileLocation } from './paths';

export type FileSnapshot = { data: Buffer; revision: string; stat: Stats };
export const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

function assertFile(stat: Stats, maxBytes: number): void {
  if (!stat.isFile() || stat.isSymbolicLink()) throw new WorkspaceFileError('unsafe_path');
  if (stat.size > maxBytes) throw new WorkspaceFileError('too_large');
}

function assertUnchanged(before: Stats, after: Stats): void {
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    !sameIdentity(before, after) ||
    before.size !== after.size ||
    before.mode !== after.mode ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    throw new WorkspaceFileError('revision_conflict');
  }
}

async function readBounded(handle: FileHandle, maxBytes: number): Promise<Buffer> {
  const buffer = Buffer.alloc(maxBytes + 1);
  let length = 0;
  while (length < buffer.length) {
    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
    if (!bytesRead) break;
    length += bytesRead;
  }
  if (length > maxBytes) throw new WorkspaceFileError('too_large');
  return buffer.subarray(0, length);
}

export function decodeText(data: Uint8Array): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
    // 常见二进制即使恰好是合法 UTF-8，仍会包含 NUL 或非文本控制字节。
    if (data.some((byte) => (byte < 32 && ![9, 10, 12, 13].includes(byte)) || byte === 127)) {
      throw new Error();
    }
    return text;
  } catch {
    throw new WorkspaceFileError('invalid_text');
  }
}

export function encodeText(content: string, maxBytes: number): Buffer {
  if (Buffer.byteLength(content, 'utf8') > maxBytes) throw new WorkspaceFileError('too_large');
  const data = Buffer.from(content, 'utf8');
  if (decodeText(data) !== content) throw new WorkspaceFileError('invalid_text');
  return data;
}

export async function readSnapshot(location: FileLocation): Promise<FileSnapshot> {
  await assertDirectoriesUnchanged(location);
  const before = await lstat(location.absolute);
  assertFile(before, location.maxBytes);
  const handle = await open(location.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    assertUnchanged(before, await handle.stat());
    const data = await readBounded(handle, location.maxBytes);
    assertUnchanged(before, await handle.stat());
    assertUnchanged(before, await lstat(location.absolute));
    await assertDirectoriesUnchanged(location);
    return { data, stat: before, revision: digest(data) };
  } finally {
    await handle.close();
  }
}

async function removeTemporary(location: FileLocation, temporary: string, expected: Stats): Promise<void> {
  await assertDirectoriesUnchanged(location);
  const current = await lstat(temporary).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (current && sameIdentity(expected, current)) await unlink(temporary);
}

export async function replaceFile(location: FileLocation, data: Buffer, before: FileSnapshot): Promise<void> {
  const temporary = path.join(path.dirname(location.absolute), `.workspace-edit-${randomUUID()}.tmp`);
  let temporaryStat: Stats | undefined;
  try {
    await assertDirectoriesUnchanged(location);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      temporaryStat = await handle.stat();
      await handle.writeFile(data);
      await handle.chmod(before.stat.mode & 0o777);
      await handle.sync();
      temporaryStat = await handle.stat();
    } finally {
      await handle.close();
    }
    const current = await readSnapshot(location);
    assertUnchanged(before.stat, current.stat);
    if (current.revision !== before.revision) throw new WorkspaceFileError('revision_conflict');
    assertUnchanged(temporaryStat, await lstat(temporary));
    await assertDirectoriesUnchanged(location);
    // 同目录替换保持原子可见；Node 跨平台 API 无法提供完整的原子条件替换。
    await rename(temporary, location.absolute);
    temporaryStat = undefined;
  } finally {
    if (temporaryStat) await removeTemporary(location, temporary, temporaryStat);
  }
}
