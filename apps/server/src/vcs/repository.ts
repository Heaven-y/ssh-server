import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Workspace } from '@ssh-server/shared';
import { assertDirectoriesUnchanged, resolveWorkspacePath, type FileLocation } from '../files/paths';
import { VersionError } from './errors';
import { git, gitText, verifyGitVersion } from './git';

export type Repository = {
  ws: Workspace;
  root: string;
  gitDir: string;
  commonDir: string;
  indexPath: string;
  prefix: string;
  objectFormat: 'sha1' | 'sha256';
  location: FileLocation;
  adminLocation: FileLocation;
};
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const scope = (repo: Repository) => (repo.prefix ? [repo.prefix] : []);
export const repoPath = (repo: Repository, relative: string) => `${repo.prefix}${relative}`;
export const relativePath = (repo: Repository, file: string) =>
  file.startsWith(repo.prefix) ? file.slice(repo.prefix.length) : undefined;

export async function present(file: string) {
  return lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
}

async function hasMarker(directory: string): Promise<boolean> {
  for (let current = directory; ; current = path.dirname(current)) {
    const marker = await present(path.join(current, '.git'));
    if (marker) {
      if (marker.isSymbolicLink() || (!marker.isDirectory() && !marker.isFile())) throw new VersionError('unsafe_path');
      return true;
    }
    if (path.dirname(current) === current) return false;
  }
}

export async function repository(ws: Workspace, initialize = false): Promise<Repository | undefined> {
  const location = await resolveWorkspacePath(ws, '', 'directory');
  await verifyGitVersion(location.absolute);
  if (!(await hasMarker(location.absolute))) {
    if (!initialize) return undefined;
    await git(location.absolute, ['init', '--quiet', '--']);
  }
  const root = await realpath(path.resolve(await gitText(location.absolute, ['rev-parse', '--show-toplevel'])));
  // Windows 临时目录可能使用 8.3 别名；链接检查完成后用实际路径比较作用域。
  const relative = path.relative(root, await realpath(location.absolute));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new VersionError('unsafe_path');
  const gitDir = path.resolve(await gitText(root, ['rev-parse', '--absolute-git-dir']));
  const commonDir = path.resolve(await gitText(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const indexPath = path.resolve(await gitText(root, ['rev-parse', '--path-format=absolute', '--git-path', 'index']));
  const adminLocation = await resolveWorkspacePath({ ...ws, localDir: gitDir }, '', 'directory');
  await resolveWorkspacePath({ ...ws, localDir: commonDir }, '', 'directory');
  await assertDirectoriesUnchanged(location);
  const objectFormat = await gitText(root, ['rev-parse', '--show-object-format']);
  if (objectFormat !== 'sha1' && objectFormat !== 'sha256') throw new VersionError('git_error');
  return {
    ws,
    root,
    gitDir,
    commonDir,
    indexPath,
    prefix: relative ? `${relative.split(path.sep).join('/')}/` : '',
    objectFormat,
    location,
    adminLocation,
  };
}

export async function headState(repo: Repository): Promise<{ head?: string; ref: string }> {
  const head = await git(repo.root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
  const branch = await git(repo.root, ['symbolic-ref', '--quiet', 'HEAD'], { allowFailure: true });
  return {
    head: head.exitCode === 0 ? head.stdout.toString().trim() : undefined,
    ref: branch.exitCode === 0 ? branch.stdout.toString().trim() : 'HEAD',
  };
}

export async function assertWritable(repo: Repository): Promise<void> {
  await assertDirectoriesUnchanged(repo.location);
  await assertDirectoriesUnchanged(repo.adminLocation);
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
    if (await present(path.join(repo.gitDir, marker))) throw new VersionError('repository_busy');
  }
  // stash pop 等冲突可能没有流程标记，工作区外的未合并索引同样阻断写操作。
  if ((await git(repo.root, ['ls-files', '--unmerged', '-z'])).stdout.length) throw new VersionError('repository_busy');
}

export async function commitId(repo: Repository, value: string): Promise<string> {
  if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value)) throw new VersionError('invalid_commit');
  const type = await git(repo.root, ['cat-file', '-t', value], { allowFailure: true });
  if (type.exitCode !== 0 || type.stdout.toString().trim() !== 'commit') throw new VersionError('invalid_commit');
  return value.toLowerCase();
}
