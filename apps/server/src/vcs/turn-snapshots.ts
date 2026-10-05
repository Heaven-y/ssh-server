import type { TurnDiff, TurnFileChange, TurnSnapshot, VersionExcluded } from '@ssh-server/shared';
import { assertAllowedPath, assertDirectoriesUnchanged } from '../files/paths';
import { VersionError } from './errors';
import { git, gitText, nulStrings } from './git';
import { patch } from './history';
import { assertFresh, prepareIndex, withIndexes } from './index';
import { assertWritable, relativePath, sha256, scope, type Repository } from './repository';
import { snapshot, treeEntries, type TreeEntry } from './snapshot';

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function identity(repo: Repository): { repositoryId: string; scope: string } {
  const directories = [...repo.location.directories, ...repo.adminLocation.directories].map(({ path, stat }) => [
    path,
    stat.dev,
    stat.ino,
    stat.birthtimeMs,
  ]);
  const repositoryId = sha256(JSON.stringify([repo.root, repo.gitDir, repo.commonDir, repo.prefix, directories]));
  return { repositoryId, scope: sha256(JSON.stringify([repositoryId, repo.ws.id, repo.location.settings])) };
}
const reference = (value: TurnSnapshot) => `refs/ssh-server/turns/${value.scope}/${value.turnId}/${value.edge}`;

function validate(value: TurnSnapshot): void {
  if (
    !UUID.test(value.turnId) ||
    !HASH.test(value.scope) ||
    !HASH.test(value.repositoryId) ||
    !OID.test(value.tree) ||
    (value.edge !== 'base' && value.edge !== 'result')
  )
    throw new VersionError('invalid_request');
}

async function verify(repo: Repository, value: TurnSnapshot): Promise<void> {
  validate(value);
  if (identity(repo).scope !== value.scope) throw new VersionError('stale_revision');
  const current = await gitText(repo.root, ['rev-parse', '--verify', reference(value)]);
  if (current !== value.tree || (await gitText(repo.root, ['cat-file', '-t', value.tree])) !== 'tree')
    throw new VersionError('stale_revision');
}

/** 写入树与专用引用；原HEAD和用户索引完全不参与安装。 */
export async function captureTurn(repo: Repository, turnId: string, edge: TurnSnapshot['edge']): Promise<TurnSnapshot> {
  if (!UUID.test(turnId)) throw new VersionError('invalid_request');
  await assertWritable(repo);
  const state = await snapshot(repo);
  return withIndexes(repo, async (index) => {
    const tree = await prepareIndex(state, index);
    await assertFresh(state);
    const value: TurnSnapshot = {
      turnId,
      edge,
      tree,
      ...identity(repo),
      revision: state.status.revision,
      createdAt: Date.now(),
    };
    validate(value);
    await git(repo.root, ['update-ref', reference(value), tree, '0'.repeat(repo.objectFormat === 'sha1' ? 40 : 64)]);
    return value;
  });
}

/** 规则改变仍可清理同仓库拥有的旧引用；目录/仓库身份改变则保留，不能指向新目标。 */
export async function releaseTurn(repo: Repository, values: TurnSnapshot[]): Promise<void> {
  await assertDirectoriesUnchanged(repo.location);
  await assertDirectoriesUnchanged(repo.adminLocation);
  for (const value of values) {
    validate(value);
    if (identity(repo).repositoryId !== value.repositoryId) throw new VersionError('stale_revision');
    const result = await git(repo.root, ['update-ref', '-d', reference(value), value.tree], { allowFailure: true });
    if (result.exitCode !== 0) throw new VersionError('stale_revision');
  }
}

const displayable = (entry: TreeEntry | undefined, limit: number) =>
  !entry || (entry.type === 'blob' && ['100644', '100755'].includes(entry.mode) && entry.size <= limit);

function parseStat(record: string): { path: string; additions: number | null; deletions: number | null } {
  const first = record.indexOf('\t');
  const second = record.indexOf('\t', first + 1);
  const parts = [record.slice(0, first), record.slice(first + 1, second), record.slice(second + 1)];
  if (first < 0 || second < 0 || !parts[2] || !/^(?:-|\d+)$/.test(parts[0]!) || !/^(?:-|\d+)$/.test(parts[1]!))
    throw new VersionError('git_error');
  return {
    path: parts[2],
    additions: parts[0] === '-' ? null : Number(parts[0]),
    deletions: parts[1] === '-' ? null : Number(parts[1]),
  };
}

export async function diffTurn(
  repo: Repository,
  base: TurnSnapshot,
  result: TurnSnapshot,
  selected?: string,
): Promise<TurnDiff> {
  if (base.turnId !== result.turnId || base.edge !== 'base' || result.edge !== 'result')
    throw new VersionError('invalid_request');
  await verify(repo, base);
  await verify(repo, result);
  if (selected !== undefined) {
    try {
      assertAllowedPath(selected, repo.location.settings);
    } catch {
      throw new VersionError('unsafe_path');
    }
  }
  const stats = await git(repo.root, [
    'diff',
    '--numstat',
    '-z',
    '--no-renames',
    '--no-ext-diff',
    '--no-textconv',
    base.tree,
    result.tree,
    '--',
    ...scope(repo),
  ]);
  const records = nulStrings(stats.stdout).map(parseStat);
  if (records.length > 10_000) throw new VersionError('limit_exceeded');
  const before = await treeEntries(repo, base.tree);
  const after = await treeEntries(repo, result.tree);
  const changes: TurnFileChange[] = [];
  const excluded: VersionExcluded[] = [];
  for (const record of records) {
    const path = relativePath(repo, record.path);
    if (path === undefined || (selected !== undefined && selected !== path)) continue;
    try {
      assertAllowedPath(path, repo.location.settings);
    } catch {
      excluded.push({ path, reason: '当前同步过滤或路径规则已排除' });
      continue;
    }
    if (
      ![before.get(path), after.get(path)].every((entry) => displayable(entry, repo.location.settings.maxFileBytes))
    ) {
      excluded.push({ path, reason: '链接、非普通对象或内容超过同步大小阈值' });
      continue;
    }
    changes.push({
      path,
      kind: !after.has(path) ? 'deleted' : before.has(path) ? 'modified' : 'added',
      additions: record.additions,
      deletions: record.deletions,
      binary: record.additions === null || record.deletions === null,
    });
  }
  const rendered = await patch(
    repo,
    ['diff', base.tree, result.tree],
    changes.map((change) => change.path),
  );
  // 外部用户可操作专用引用，不能在读取期间接受被替换的对象。
  await verify(repo, base);
  await verify(repo, result);
  return { ...rendered, changes, excluded };
}
