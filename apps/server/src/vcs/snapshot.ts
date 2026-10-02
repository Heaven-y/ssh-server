import type { Stats } from 'node:fs';
import path from 'node:path';
import type { VersionChange, VersionExcluded, VersionStatus } from '@ssh-server/shared';
import { WorkspaceFileError } from '../files/errors';
import { readSnapshot } from '../files/io';
import { assertAllowedPath, assertDirectoriesUnchanged, resolveWorkspacePath } from '../files/paths';
import { VersionError } from './errors';
import { git, gitText, nulStrings } from './git';
import { headState, present, relativePath, repoPath, scope, sha256, type Repository } from './repository';

export type TreeEntry = { mode: string; type: string; oid: string; size: number };
export type IndexEntry = { mode: string; oid: string; stage: string };
export type WorkingFile = { data?: Buffer; stat?: Stats; reason?: string; directory?: boolean; blockedBy?: string };
export type Snapshot = {
  repo: Repository;
  head?: string;
  ref: string;
  index?: Buffer;
  indexRevision: string;
  tree: Map<string, TreeEntry>;
  staged: Map<string, IndexEntry>;
  files: Map<string, WorkingFile>;
  status: VersionStatus;
  conflicted: boolean;
};
const MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const MAX_INDEX_BYTES = 32 * 1024 * 1024;

export async function readIndex(repo: Repository): Promise<{ data?: Buffer; revision: string }> {
  if (!(await present(repo.indexPath))) return { revision: 'missing' };
  const directory = await resolveWorkspacePath({ ...repo.ws, localDir: path.dirname(repo.indexPath) }, '', 'directory');
  const current = await readSnapshot({ ...directory, absolute: repo.indexPath, maxBytes: MAX_INDEX_BYTES });
  return { data: current.data, revision: current.revision };
}

export async function treeEntries(repo: Repository, commit?: string, all = false): Promise<Map<string, TreeEntry>> {
  const entries = new Map<string, TreeEntry>();
  if (!commit) return entries;
  const result = await git(repo.root, ['ls-tree', '-r', '-l', '-z', commit, '--', ...(all ? [] : scope(repo))]);
  for (const record of nulStrings(result.stdout)) {
    const tab = record.indexOf('\t');
    const values = record.slice(0, tab).trim().split(/\s+/);
    if (values.length !== 4 || tab < 0) throw new VersionError('git_error');
    const relative = all ? record.slice(tab + 1) : relativePath(repo, record.slice(tab + 1));
    if (relative !== undefined)
      entries.set(relative, { mode: values[0]!, type: values[1]!, oid: values[2]!, size: Number(values[3]) });
  }
  return entries;
}

export async function indexEntries(repo: Repository, index?: string, all = false): Promise<Map<string, IndexEntry>> {
  const entries = new Map<string, IndexEntry>();
  const result = await git(repo.root, ['ls-files', '--stage', '-z', '--', ...(all ? [] : scope(repo))], { index });
  for (const record of nulStrings(result.stdout)) {
    const tab = record.indexOf('\t');
    const [mode, oid, stage] = record.slice(0, tab).split(' ');
    const relative = all ? record.slice(tab + 1) : relativePath(repo, record.slice(tab + 1));
    if (relative !== undefined && mode && oid && stage) entries.set(relative, { mode, oid, stage });
  }
  return entries;
}

function fileReason(error: unknown): string | undefined {
  if (error instanceof WorkspaceFileError) {
    if (error.code === 'excluded') return '同步规则已排除';
    if (error.code === 'too_large') return '超过同步大小阈值';
    return '路径不安全或经过链接';
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return undefined;
  if (code === 'ENOTDIR') return '父路径不是目录';
  throw error;
}

export async function workingFile(repo: Repository, relative: string): Promise<WorkingFile> {
  try {
    assertAllowedPath(relative, repo.location.settings);
    const blocker = await parentBlocker(repo, relative);
    if (blocker) return blocker;
    const location = await resolveWorkspacePath(repo.ws, relative, 'file');
    const stat = await present(location.absolute);
    if (!stat) return {};
    if (stat.isDirectory()) return { stat, directory: true, reason: '当前路径是目录' };
    const snapshot = await readSnapshot({ ...location, maxBytes: repo.location.settings.maxFileBytes });
    return { data: snapshot.data, stat: snapshot.stat };
  } catch (error) {
    return { reason: fileReason(error) };
  }
}

async function parentBlocker(repo: Repository, relative: string): Promise<WorkingFile | undefined> {
  const parts = relative.split('/');
  for (let index = 1; index < parts.length; index++) {
    const parent = parts.slice(0, index).join('/');
    const directory = path.join(repo.ws.localDir, parent);
    const stat = await present(directory);
    if (stat?.isSymbolicLink()) return { reason: '路径不安全或经过链接' };
    if (stat?.isFile()) return { blockedBy: parent };
    if (await present(path.join(directory, '.git'))) return { reason: '嵌套 Git 仓库不参与版本记录' };
  }
  return undefined;
}

export function fingerprint(file: WorkingFile): unknown[] {
  const stat = file.stat;
  return [
    file.reason,
    file.blockedBy,
    file.data && sha256(file.data),
    stat && [stat.dev, stat.ino, stat.birthtimeMs, stat.size, stat.mode, stat.mtimeMs, stat.ctimeMs],
  ];
}

async function changedPaths(repo: Repository): Promise<Set<string>> {
  const result = await git(repo.root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--no-renames',
    '--untracked-files=all',
    '--',
    ...scope(repo),
  ]);
  return new Set(
    nulStrings(result.stdout).flatMap((record) => {
      const relative = relativePath(repo, record.slice(3));
      return relative === undefined ? [] : [relative];
    }),
  );
}

function entryReason(file: WorkingFile, base?: TreeEntry, staged?: IndexEntry): string | undefined {
  if (base && base.type !== 'blob') return '子模块或非普通 Git 对象';
  if ([base, staged].some((entry) => entry?.mode === '120000')) return '符号链接不参与版本记录';
  if (staged?.mode === '160000') return '子模块不参与版本记录';
  if (file.reason === '超过同步大小阈值') return file.reason;
  if (file.directory && [base, staged].some(Boolean)) return undefined;
  return file.reason;
}

async function priorSize(
  repo: Repository,
  relative: string,
  tree: Map<string, TreeEntry>,
  staged: Map<string, IndexEntry>,
): Promise<number> {
  const recorded = tree.get(relative);
  const index = staged.get(relative);
  // Git 子模块指向另一个仓库的提交，该对象不要求存在于父仓库。
  if (index?.mode === '160000') return 0;
  if (!index || index.oid === recorded?.oid) return recorded?.size ?? 0;
  const stagedSize = Number(await gitText(repo.root, ['cat-file', '-s', index.oid]));
  return Math.max(recorded?.size ?? 0, stagedSize);
}

async function collectWorking(
  repo: Repository,
  paths: string[],
  tree: Map<string, TreeEntry>,
  staged: Map<string, IndexEntry>,
) {
  if (paths.length > 10_000) throw new VersionError('limit_exceeded');
  const files = new Map<string, WorkingFile>();
  let size = 0;
  for (const relative of paths) {
    const file = await workingFile(repo, relative);
    if (file.data) size += file.data.length;
    if (size > MAX_SNAPSHOT_BYTES) throw new VersionError('limit_exceeded');
    if ((await priorSize(repo, relative, tree, staged)) > repo.location.settings.maxFileBytes)
      file.reason = '超过同步大小阈值';
    file.reason = entryReason(file, tree.get(relative), staged.get(relative));
    files.set(relative, file);
  }
  return files;
}

async function summarize(repo: Repository, files: Map<string, WorkingFile>, tree: Map<string, TreeEntry>) {
  const changed = await changedPaths(repo);
  const changes: VersionChange[] = [];
  const excluded: VersionExcluded[] = [];
  for (const relative of changed) {
    const file = files.get(relative) ?? { reason: '路径不安全或不在普通文件范围' };
    if (file.reason) excluded.push({ path: relative, reason: file.reason });
    else changes.push({ path: relative, kind: file.data ? (tree.has(relative) ? 'modified' : 'added') : 'deleted' });
  }
  return { changes, excluded };
}

export async function snapshot(repo: Repository, extra: string[] = []): Promise<Snapshot> {
  const state = await headState(repo);
  const originalIndex = await readIndex(repo);
  const tree = await treeEntries(repo, state.head);
  const staged = await indexEntries(repo);
  const others = await git(repo.root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...scope(repo)]);
  const untracked = nulStrings(others.stdout).flatMap((file) => {
    const value = relativePath(repo, file);
    return value === undefined ? [] : [value];
  });
  const paths = [...new Set([...tree.keys(), ...staged.keys(), ...untracked, ...extra])].sort();
  const files = await collectWorking(repo, paths, tree, staged);
  const changes = await summarize(repo, files, tree);
  const latest = await headState(repo);
  if (JSON.stringify(state) !== JSON.stringify(latest) || (await readIndex(repo)).revision !== originalIndex.revision)
    throw new VersionError('stale_revision');
  await assertDirectoriesUnchanged(repo.location);
  const revision = sha256(
    JSON.stringify([
      state,
      originalIndex.revision,
      repo.ws.localDir,
      repo.location.settings,
      [...files].map(([file, value]) => [file, fingerprint(value)]),
    ]),
  );
  return {
    repo,
    ...state,
    index: originalIndex.data,
    indexRevision: originalIndex.revision,
    tree,
    staged,
    files,
    conflicted: [...staged.values()].some((entry) => entry.stage !== '0'),
    status: {
      initialized: true,
      head: state.head,
      branch: state.ref.startsWith('refs/heads/') ? state.ref.slice(11) : undefined,
      revision,
      ...changes,
    },
  };
}

export async function ignoredPaths(repo: Repository, paths: string[]): Promise<Set<string>> {
  if (!paths.length) return new Set();
  const result = await git(repo.root, ['check-ignore', '-z', '--stdin'], {
    literal: false,
    input: paths.map((file) => `${repoPath(repo, file)}\0`).join(''),
    allowFailure: true,
  });
  if (result.exitCode !== 0 && result.exitCode !== 1) throw new VersionError('git_error');
  return new Set(
    nulStrings(result.stdout).flatMap((file) => {
      const relative = relativePath(repo, file);
      return relative === undefined ? [] : [relative];
    }),
  );
}
