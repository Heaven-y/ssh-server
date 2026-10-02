import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rmdir, unlink, writeFile, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { assertDirectoriesUnchanged, sameIdentity } from '../files/paths';
import { VersionError } from './errors';
import { git, gitText } from './git';
import { assertWritable, present, repoPath, type Repository } from './repository';
import { indexEntries, readIndex, snapshot, treeEntries, type Snapshot } from './snapshot';

type IndexLock = { file: string; handle: FileHandle; installed: boolean };

export async function withIndexLock<T>(repo: Repository, operation: (lock: IndexLock) => Promise<T>): Promise<T> {
  await assertWritable(repo);
  const file = `${repo.indexPath}.lock`;
  const handle = await open(file, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST') throw new VersionError('repository_busy');
    throw error;
  });
  const owned = await handle.stat();
  const lock: IndexLock = { file, handle, installed: false };
  try {
    return await operation(lock);
  } finally {
    await handle.close();
    if (!lock.installed) {
      await assertDirectoriesUnchanged(repo.adminLocation);
      const stat = await present(file);
      if (stat && sameIdentity(stat, owned)) await unlink(file);
    }
  }
}

export async function withIndexes<T>(
  repo: Repository,
  operation: (record: string, preserved: string) => Promise<T>,
): Promise<T> {
  await assertDirectoriesUnchanged(repo.adminLocation);
  const directory = path.join(repo.gitDir, `.workspace-vcs-${randomUUID()}`);
  await mkdir(directory, { mode: 0o700 });
  const record = path.join(directory, 'record');
  const preserved = path.join(directory, 'preserved');
  try {
    return await operation(record, preserved);
  } finally {
    await assertDirectoriesUnchanged(repo.adminLocation);
    for (const file of [record, preserved, `${record}.lock`, `${preserved}.lock`]) {
      await unlink(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    await rmdir(directory);
  }
}

export async function prepareIndex(state: Snapshot, index: string): Promise<string> {
  const { repo } = state;
  await assertHierarchy(state);
  await git(repo.root, ['read-tree', ...(state.head ? [state.head] : ['--empty'])], { index });
  const changed = state.status.changes.map((change) => change.path);
  const existing = changed.filter((file) => state.files.get(file)?.data !== undefined);
  const deleted = changed.filter((file) => state.files.get(file)?.data === undefined);
  if (deleted.length)
    await git(repo.root, ['update-index', '--force-remove', '-z', '--stdin'], {
      index,
      input: deleted.map((file) => `${repoPath(repo, file)}\0`).join(''),
    });
  if (existing.length)
    await git(repo.root, ['add', '--all', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      index,
      input: existing.map((file) => `${repoPath(repo, file)}\0`).join(''),
    });
  return gitText(repo.root, ['write-tree'], { index });
}

async function assertHierarchy(state: Snapshot): Promise<void> {
  const tree = await treeEntries(state.repo, state.head, true);
  const staged = await indexEntries(state.repo, undefined, true);
  if ([...staged.values()].some((entry) => entry.stage !== '0')) throw new VersionError('repository_busy');
  const allowed = new Set(state.status.changes.map((change) => repoPath(state.repo, change.path)));
  const protectedPaths = [...new Set([...tree.keys(), ...staged.keys()])].filter((file) => !allowed.has(file));
  for (const change of state.status.changes) {
    if (state.files.get(change.path)?.data === undefined) continue;
    const candidate = repoPath(state.repo, change.path);
    if (protectedPaths.some((file) => file.startsWith(`${candidate}/`) || candidate.startsWith(`${file}/`)))
      throw new VersionError('hierarchy_conflict');
  }
}

async function preservedIndex(state: Snapshot, recorded: string, output: string): Promise<void> {
  if (state.index) await writeFile(output, state.index, { flag: 'wx', mode: 0o600 });
  else await git(state.repo.root, ['read-tree', '--empty'], { index: output });
  const recordedEntries = await indexEntries(state.repo, recorded);
  const zero = '0'.repeat(state.repo.objectFormat === 'sha1' ? 40 : 64);
  const instructions = state.status.changes
    .map(({ path: file }) => {
      const entry = recordedEntries.get(file);
      return `${entry?.mode ?? '0'} ${entry?.oid ?? zero}\t${repoPath(state.repo, file)}\0`;
    })
    .join('');
  if (instructions)
    await git(state.repo.root, ['update-index', '-z', '--index-info'], { index: output, input: instructions });
}

export async function assertFresh(state: Snapshot, revision = state.status.revision): Promise<void> {
  await assertWritable(state.repo);
  if ((await snapshot(state.repo)).status.revision !== revision) throw new VersionError('stale_revision');
}

async function installIndex(state: Snapshot, preserved: string, lock: IndexLock): Promise<void> {
  const data = await readIndex({ ...state.repo, indexPath: preserved });
  if (!data.data) throw new VersionError('git_error');
  const mode = (await present(state.repo.indexPath))?.mode ?? 0o600;
  await lock.handle.writeFile(data.data);
  await lock.handle.chmod(mode & 0o777);
  await lock.handle.sync();
}

async function rollbackHead(state: Snapshot, commit: string): Promise<void> {
  const args = state.head ? ['update-ref', state.ref, state.head, commit] : ['update-ref', '-d', state.ref, commit];
  const result = await git(state.repo.root, args, { allowFailure: true });
  if (result.exitCode !== 0) throw new VersionError('partial_save');
}

async function createCommit(state: Snapshot, tree: string, message: string): Promise<string> {
  for (const identity of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
    const result = await git(state.repo.root, ['var', identity], { allowFailure: true });
    if (result.exitCode !== 0 || !/^.+ <[^<>\s]+> \d+ [+-]\d{4}$/.test(result.stdout.toString().trim()))
      throw new VersionError('identity_missing');
  }
  const commit = await gitText(state.repo.root, ['commit-tree', tree, ...(state.head ? ['-p', state.head] : [])], {
    input: `${message}\n`,
  });
  await assertFresh(state);
  const zero = '0'.repeat(state.repo.objectFormat === 'sha1' ? 40 : 64);
  const result = await git(
    state.repo.root,
    ['update-ref', '-m', '保存工作区版本', state.ref, commit, state.head ?? zero],
    { allowFailure: true },
  );
  if (result.exitCode !== 0) throw new VersionError('stale_revision');
  return commit;
}

export async function commitWorkspace(state: Snapshot, message: string): Promise<string | undefined> {
  if (state.conflicted) throw new VersionError('repository_busy');
  return withIndexLock(state.repo, async (lock) =>
    withIndexes(state.repo, async (record, preserved) => {
      await assertFresh(state);
      const tree = await prepareIndex(state, record);
      const oldTree = state.head
        ? await gitText(state.repo.root, ['rev-parse', `${state.head}^{tree}`])
        : await gitText(state.repo.root, ['hash-object', '-t', 'tree', '--stdin'], { input: '' });
      await preservedIndex(state, record, preserved);
      await assertFresh(state);
      await installIndex(state, preserved, lock);
      const commit = tree !== oldTree ? await createCommit(state, tree, message) : undefined;
      try {
        await assertDirectoriesUnchanged(state.repo.adminLocation);
        await rename(lock.file, state.repo.indexPath);
        lock.installed = true;
      } catch (error) {
        if (commit) await rollbackHead(state, commit);
        throw error;
      }
      return commit;
    }),
  );
}
