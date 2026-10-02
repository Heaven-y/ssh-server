// 非空目录建立基线前保留同名差异，避免 resync 选择一端覆盖另一端。
import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import type { SyncConflict, SyncSettings, Workspace } from '@ssh-server/shared';
import { hash, localHash, safeLocalFile, type FileEntry } from './inventory';
import type { RcloneContext } from './rclone';

export async function preserveInitialConflicts(
  input: { ws: Workspace; settings: SyncSettings; local: FileEntry[]; remote: FileEntry[] },
  context: RcloneContext,
): Promise<SyncConflict[]> {
  const remote = new Map(input.remote.map((file) => [file.path, file]));
  const conflicts: SyncConflict[] = [];
  for (const file of input.local) {
    if (!remote.has(file.path)) continue;
    const local = await localHash(input.ws.localDir, file, input.settings);
    const other = hash(await context.readRemote(file.path));
    if (local === other) continue;
    const suffix = randomUUID();
    const localCopy = `${file.path}.ssh-local-conflict-${suffix}`;
    const remoteCopy = `${file.path}.ssh-remote-conflict-${suffix}`;
    await rename(await safeLocalFile(input.ws.localDir, file.path), await safeLocalFile(input.ws.localDir, localCopy));
    await context.moveRemote(file.path, remoteCopy);
    conflicts.push({ path: file.path, localCopy, remoteCopy });
  }
  return conflicts;
}
