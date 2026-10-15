import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { WorkspaceFileError } from './errors';
import { assertDirectoriesUnchanged, sameIdentity, type FileLocation } from './paths';
/** 内容摘要：版本与索引使用同一算法，读取快照不再单独保存 revision。 */
export const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

export type FileSnapshot = { data: Buffer; stat: Stats };

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
    // 读取期间被改写：本次快照已失效，按“不是有效文本”提示重新读取。
    throw new WorkspaceFileError('invalid_text');
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

/** 读取期间多次核对文件身份与内容，确保返回的快照来自同一份内容。 */
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
    return { data, stat: before };
  } finally {
    await handle.close();
  }
}
