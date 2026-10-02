import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, opendir, rename, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { assertDirectoriesUnchanged, sameIdentity } from '../files/paths';
import { VersionError } from './errors';
import { present, type Repository } from './repository';
import { fingerprint, workingFile, type WorkingFile } from './snapshot';

export type RestoreFile = { path: string; before: WorkingFile; data?: Buffer; mode?: number; structural?: boolean };

export async function directoryContainsOnly(
  repo: Repository,
  relative: string,
  deletions: Set<string>,
): Promise<boolean> {
  const directory = await opendir(path.join(repo.ws.localDir, relative));
  let count = 0;
  for await (const item of directory) {
    if (++count > 10_000) throw new VersionError('limit_exceeded');
    const file = `${relative}/${item.name}`;
    const stat = await lstat(path.join(repo.ws.localDir, file));
    if (stat.isSymbolicLink()) return false;
    if (stat.isDirectory()) {
      if (!(await directoryContainsOnly(repo, file, deletions))) return false;
    } else if (!stat.isFile() || !deletions.has(file)) return false;
  }
  return true;
}

async function ensureParents(repo: Repository, relative: string): Promise<void> {
  await assertDirectoriesUnchanged(repo.location);
  let current = repo.ws.localDir;
  for (const part of relative.split('/').slice(0, -1)) {
    current = path.join(current, part);
    if (!(await present(current))) await mkdir(current, { mode: 0o755 });
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new VersionError('unsafe_path');
  }
}

async function pruneEmpty(repo: Repository, relative: string): Promise<void> {
  const absolute = path.join(repo.ws.localDir, relative);
  const stat = await lstat(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new VersionError('unsafe_path');
  const directory = await opendir(absolute);
  for await (const item of directory) {
    if (!item.isDirectory() || item.isSymbolicLink()) throw new VersionError('stale_revision');
    await pruneEmpty(repo, `${relative}/${item.name}`);
  }
  await rmdir(absolute);
}

async function writeAtomic(repo: Repository, file: RestoreFile): Promise<void> {
  const target = path.join(repo.ws.localDir, file.path);
  if (file.before.directory) await pruneEmpty(repo, file.path);
  await ensureParents(repo, file.path);
  const temporary = path.join(path.dirname(target), `.workspace-restore-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  const owned = await handle.stat();
  let installed = false;
  try {
    await handle.writeFile(file.data!);
    await handle.chmod(file.mode ?? 0o644);
    await handle.sync();
    await handle.close();
    await ensureParents(repo, file.path);
    const before = await workingFile(repo, file.path);
    const expected = file.before.directory ? {} : file.before;
    if (JSON.stringify(fingerprint(before)) !== JSON.stringify(fingerprint(expected)))
      throw new VersionError('stale_revision');
    const pending = await lstat(temporary);
    if (!pending.isFile() || !sameIdentity(owned, pending)) throw new VersionError('unsafe_path');
    await rename(temporary, target);
    installed = true;
  } finally {
    await handle.close();
    if (!installed) {
      await ensureParents(repo, file.path);
      const pending = await present(temporary);
      if (pending && sameIdentity(owned, pending)) await unlink(temporary);
    }
  }
}

async function apply(repo: Repository, file: RestoreFile): Promise<void> {
  await ensureParents(repo, file.path);
  const current = await workingFile(repo, file.path);
  if (!file.before.directory && JSON.stringify(fingerprint(current)) !== JSON.stringify(fingerprint(file.before)))
    throw new VersionError('stale_revision');
  if (file.data !== undefined) await writeAtomic(repo, file);
  else await unlink(path.join(repo.ws.localDir, file.path));
}

export async function applyRestore(repo: Repository, operations: RestoreFile[]): Promise<string[]> {
  const applied: { operation: RestoreFile; installed: WorkingFile }[] = [];
  let unverified: string | undefined;
  try {
    for (const operation of operations) {
      await apply(repo, operation);
      unverified = operation.path;
      applied.push({ operation, installed: await workingFile(repo, operation.path) });
      unverified = undefined;
    }
    return operations.map((file) => file.path);
  } catch (error) {
    const remaining: string[] = unverified ? [unverified] : [];
    for (const { operation, installed } of applied.reverse()) {
      try {
        await apply(repo, {
          path: operation.path,
          before: installed,
          data: operation.before.data,
          mode: operation.before.stat?.mode && operation.before.stat.mode & 0o777,
        });
      } catch {
        remaining.push(operation.path);
      }
    }
    if (remaining.length) throw new VersionError('partial_restore', remaining);
    throw error;
  }
}
