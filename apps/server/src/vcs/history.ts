import type { VersionCommit, VersionDiff, VersionHistory } from '@ssh-server/shared';
import { assertAllowedPath } from '../files/paths';
import { VersionError } from './errors';
import { git, gitText, nulStrings } from './git';
import { prepareIndex, withIndexes } from './index';
import { commitId, headState, relativePath, repoPath, scope, type Repository } from './repository';
import { snapshot, treeEntries, type TreeEntry } from './snapshot';

const DIFF_CAP = 512 * 1024;
const COMMIT_FORMAT = '%H%x00%s%x00%ct';

function parseCommits(data: Buffer): VersionCommit[] {
  const parts = new TextDecoder('utf-8').decode(data).split('\0');
  if (parts.at(-1) === '') parts.pop();
  if (parts.length % 3) throw new VersionError('git_error');
  const commits: VersionCommit[] = [];
  for (let index = 0; index + 2 < parts.length; index += 3) {
    const id = parts[index]!;
    const timestamp = Number(parts[index + 2]) * 1000;
    if (
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(id) ||
      !/^\d+$/.test(parts[index + 2]!) ||
      !Number.isSafeInteger(timestamp)
    )
      throw new VersionError('git_error');
    commits.push({ id, subject: parts[index + 1]!, timestamp });
  }
  return commits;
}

export async function commitInfo(repo: Repository, id: string): Promise<VersionCommit> {
  const result = await git(repo.root, ['show', '-s', `--format=${COMMIT_FORMAT}`, '-z', id]);
  const commit = parseCommits(result.stdout)[0];
  if (!commit) throw new VersionError('git_error');
  return commit;
}

export async function history(repo: Repository, skip: number): Promise<VersionHistory> {
  if (!Number.isSafeInteger(skip) || skip < 0 || skip > 1_000_000) throw new VersionError('invalid_request');
  if (!(await headState(repo)).head) return { commits: [], hasMore: false };
  const result = await git(repo.root, [
    'log',
    '-z',
    `--format=${COMMIT_FORMAT}`,
    '--max-count=31',
    `--skip=${skip}`,
    '--',
    ...scope(repo),
  ]);
  const commits = parseCommits(result.stdout);
  return { commits: commits.slice(0, 30), hasMore: commits.length > 30 };
}

async function patch(repo: Repository, args: string[], files: string[]): Promise<VersionDiff> {
  if (!files.length) return { text: '当前范围没有可显示的差异。', files, truncated: false };
  if (files.join('').length > 20_000) return { text: '差异文件较多，请选择单个文件查看。', files, truncated: true };
  try {
    const result = await git(
      repo.root,
      [
        ...args,
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '--no-renames',
        '--',
        ...files.map((file) => repoPath(repo, file)),
      ],
      { outputCap: DIFF_CAP },
    );
    return { text: result.stdout.toString('utf8') || '文件内容没有差异。', files, truncated: false };
  } catch (error) {
    if (error instanceof VersionError && error.code === 'limit_exceeded')
      return { text: '差异超过显示上限，请按文件缩小范围；大型二进制内容不在网页展开。', files, truncated: true };
    throw error;
  }
}

function validateDiffPath(repo: Repository, file?: string): void {
  if (file !== undefined) {
    try {
      assertAllowedPath(file, repo.location.settings);
    } catch {
      throw new VersionError('unsafe_path');
    }
  }
}

function displayable(repo: Repository, entry?: TreeEntry): boolean {
  return (
    !entry || (entry.type === 'blob' && entry.mode !== '120000' && entry.size <= repo.location.settings.maxFileBytes)
  );
}

function excludedDiff(files: string[], reason: string): VersionDiff {
  return { text: `未显示差异：${reason}。`, files, truncated: false };
}

export async function diff(repo: Repository, input: { commit?: string; path?: string }): Promise<VersionDiff> {
  validateDiffPath(repo, input.path);
  if (!input.commit) {
    const state = await snapshot(repo);
    const excluded = state.status.excluded.find((entry) => entry.path === input.path);
    if (excluded) return excludedDiff([excluded.path], excluded.reason);
    if (!state.status.changes.length && state.status.excluded.length)
      return excludedDiff([], '当前改动已被同步过滤或大小规则排除');
    return withIndexes(repo, async (index) => {
      const tree = await prepareIndex(state, index);
      const base =
        state.head ??
        (await (async () => {
          const result = await git(repo.root, ['hash-object', '-w', '-t', 'tree', '--stdin'], { input: '' });
          return result.stdout.toString().trim();
        })());
      if ((await snapshot(repo)).status.revision !== state.status.revision) throw new VersionError('stale_revision');
      const files = state.status.changes
        .map((change) => change.path)
        .filter((file) => !input.path || input.path === file);
      return patch(repo, ['diff', base, tree], files);
    });
  }
  const commit = await commitId(repo, input.commit);
  const names = await git(repo.root, [
    'diff-tree',
    '--root',
    '--first-parent',
    '-m',
    '--no-commit-id',
    '--name-only',
    '--no-renames',
    '-r',
    '-z',
    commit,
    '--',
    ...scope(repo),
  ]);
  const tree = await treeEntries(repo, commit);
  const parent = (await gitText(repo.root, ['rev-list', '--parents', '-n', '1', commit])).split(' ')[1];
  const previous = await treeEntries(repo, parent);
  const files = [...new Set(nulStrings(names.stdout))].flatMap((name) => {
    const relative = relativePath(repo, name);
    if (relative === undefined || (input.path && relative !== input.path)) return [];
    try {
      assertAllowedPath(relative, repo.location.settings);
    } catch {
      return [];
    }
    return displayable(repo, tree.get(relative)) && displayable(repo, previous.get(relative)) ? [relative] : [];
  });
  if (!files.length && names.stdout.length) return excludedDiff([], '匹配文件被同步过滤、对象类型或大小规则排除');
  return patch(repo, ['show', '--format=', '--first-parent', '--root', '--patch', commit], files);
}
