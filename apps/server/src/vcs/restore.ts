import type { VersionChange, VersionExcluded, VersionRestorePreview } from '@ssh-server/shared';
import { assertAllowedPath } from '../files/paths';
import { VersionError } from './errors';
import { git, gitText } from './git';
import { withIndexLock } from './index';
import { assertWritable, headState, repoPath, sha256, type Repository } from './repository';
import { applyRestore, directoryContainsOnly, type RestoreFile } from './restore-files';
import {
  fingerprint,
  ignoredPaths,
  snapshot,
  treeEntries,
  type Snapshot,
  type TreeEntry,
  type WorkingFile,
} from './snapshot';

type RestorePlan = { state: Snapshot; operations: RestoreFile[]; preview: VersionRestorePreview };

function targetReason(repo: Repository, entry?: TreeEntry): string | undefined {
  if (!entry) return undefined;
  if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) return '链接、子模块或非普通 Git 对象';
  if (entry.size > repo.location.settings.maxFileBytes) return '历史内容超过同步大小阈值';
  return undefined;
}

function restoredMode(entry: TreeEntry, current: WorkingFile): number {
  const permissions = current.stat ? current.stat.mode & 0o666 : 0o644;
  return permissions | (entry.mode === '100755' ? (permissions & 0o444) >> 2 : 0);
}

function unchangedFile(current: WorkingFile, data: Buffer, mode: number): boolean {
  const unchangedMode = process.platform === 'win32' || ((current.stat?.mode ?? 0) & 0o111) === (mode & 0o111);
  return current.data?.equals(data) === true && unchangedMode;
}

async function operationFor(
  repo: Repository,
  input: { commit: string; relative: string; current: WorkingFile; target?: TreeEntry },
): Promise<RestoreFile | undefined> {
  const { commit, relative, current, target } = input;
  if (!target) return current.data ? { path: relative, before: current } : undefined;
  const result = await git(repo.root, ['cat-file', '--filters', `--path=${repoPath(repo, relative)}`, target.oid], {
    attributes: commit,
    outputCap: repo.location.settings.maxFileBytes + 1,
  });
  if (result.stdout.length > repo.location.settings.maxFileBytes) throw new VersionError('limit_exceeded');
  const mode = restoredMode(target, current);
  if (unchangedFile(current, result.stdout, mode)) return undefined;
  return {
    path: relative,
    before: current,
    data: result.stdout,
    mode,
    structural: current.directory || current.blockedBy !== undefined,
  };
}

async function resolveStructural(
  plan: RestoreFile[],
  state: Snapshot,
  excluded: VersionExcluded[],
): Promise<RestoreFile[]> {
  const deleted = new Set(plan.filter((file) => file.data === undefined).map((file) => file.path));
  const safe: RestoreFile[] = [];
  for (const file of plan) {
    if (!file.structural) {
      safe.push(file);
      continue;
    }
    if (file.before.directory) {
      if (await directoryContainsOnly(state.repo, file.path, deleted)) safe.push(file);
      else excluded.push({ path: file.path, reason: '目录中仍有未跟踪、排除或不应删除的文件' });
    } else {
      const parts = file.path.split('/');
      const blocking = parts
        .slice(0, -1)
        .map((_, index) => parts.slice(0, index + 1).join('/'))
        .filter((parent) => state.files.get(parent)?.data !== undefined);
      if (blocking.length && blocking.every((parent) => deleted.has(parent))) safe.push({ ...file, before: {} });
      else excluded.push({ path: file.path, reason: '父路径与现有文件冲突' });
    }
  }
  return safe.sort(
    (left, right) =>
      Number(left.data !== undefined) - Number(right.data !== undefined) ||
      right.path.split('/').length - left.path.split('/').length,
  );
}

function previewChange(operation: RestoreFile, state: Snapshot): VersionChange {
  const changed: VersionChange = {
    path: operation.path,
    kind:
      operation.data === undefined
        ? 'deleted'
        : operation.before.data || operation.before.directory
          ? 'modified'
          : 'added',
  };
  if (
    operation.data !== undefined &&
    operation.before.data !== undefined &&
    !state.tree.has(operation.path) &&
    !state.staged.has(operation.path)
  )
    changed.untrackedOverwrite = true;
  return changed;
}

function validatePath(repo: Repository, relative?: string): void {
  if (relative !== undefined) {
    try {
      assertAllowedPath(relative, repo.location.settings);
    } catch {
      throw new VersionError('unsafe_path');
    }
  }
}

function exclusion(repo: Repository, current: WorkingFile, ignored: boolean, entry?: TreeEntry): string | undefined {
  const structural = current.directory || current.blockedBy !== undefined;
  return (
    targetReason(repo, entry) ??
    (structural ? undefined : current.reason) ??
    (ignored ? 'Git 忽略规则已排除' : undefined)
  );
}

async function collectOperations(
  state: Snapshot,
  target: Map<string, TreeEntry>,
  paths: string[],
  commit: string,
  discard: boolean,
) {
  const repo = state.repo;
  const ignored = await ignoredPaths(repo, paths);
  const excluded: VersionExcluded[] = [];
  const operations: RestoreFile[] = [];
  let bytes = 0;
  for (const file of paths) {
    const current = state.files.get(file) ?? {};
    const entry = target.get(file);
    const reason = exclusion(repo, current, ignored.has(file), entry);
    if (reason) {
      excluded.push({ path: file, reason });
      continue;
    }
    if (!discard && !entry && !state.tree.has(file) && !state.staged.has(file)) continue;
    const operation = await operationFor(repo, { commit, relative: file, current, target: entry });
    if (operation) {
      if (operation.data) bytes += operation.data.length;
      if (bytes > 128 * 1024 * 1024) throw new VersionError('limit_exceeded');
      operations.push(operation);
    }
  }
  return { operations, excluded };
}

export async function restorePlan(
  repo: Repository,
  commit: string,
  relative?: string,
  discard = false,
): Promise<RestorePlan> {
  validatePath(repo, relative);
  const target = await treeEntries(repo, commit);
  const state = await snapshot(repo, [...target.keys()]);
  if (discard && relative) {
    const recorded = state.tree.get(relative);
    const staged = state.staged.get(relative);
    if (recorded?.oid !== staged?.oid || recorded?.mode !== staged?.mode || (staged && staged.stage !== '0'))
      throw new VersionError('staged_changes');
  }
  const paths = relative
    ? [relative]
    : [...new Set([...state.tree.keys(), ...state.staged.keys(), ...target.keys()])].sort();
  const { operations, excluded } = await collectOperations(state, target, paths, commit, discard);
  const safe = await resolveStructural(operations, state, excluded);
  // 确认令牌同时绑定最终计划；被忽略的目录内容也可能改变安全恢复范围。
  const revision = sha256(
    JSON.stringify([
      state.status.revision,
      commit,
      relative ?? '',
      safe.map((file) => [file.path, file.data && sha256(file.data), file.mode, fingerprint(file.before)]),
      excluded,
    ]),
  );
  return {
    state,
    operations: safe,
    preview: { commit, path: relative, revision, changes: safe.map((file) => previewChange(file, state)), excluded },
  };
}

export async function discardPlan(repo: Repository, relative: string): Promise<RestorePlan> {
  validatePath(repo, relative);
  const { head } = await headState(repo);
  const target = head ?? (await gitText(repo.root, ['hash-object', '-w', '-t', 'tree', '--stdin'], { input: '' }));
  const plan = await restorePlan(repo, target, relative, true);
  if (plan.state.head !== head) throw new VersionError('stale_revision');
  return plan;
}

async function applyPlan(repo: Repository, input: { commit?: string; path?: string; revision: string }) {
  return withIndexLock(repo, async () => {
    await assertWritable(repo);
    const plan = input.commit
      ? await restorePlan(repo, input.commit, input.path)
      : await discardPlan(repo, input.path!);
    if (plan.state.conflicted) throw new VersionError('repository_busy');
    if (plan.preview.revision !== input.revision) throw new VersionError('stale_revision');
    // blob 准备期间仍可能有外部编辑，落盘前再核对整个确认范围。
    const latest = await snapshot(repo, [...plan.state.files.keys()]);
    if (latest.status.revision !== plan.state.status.revision) throw new VersionError('stale_revision');
    const restored = await applyRestore(repo, plan.operations);
    try {
      return { restored, status: (await snapshot(repo)).status };
    } catch {
      throw new VersionError('partial_restore', restored);
    }
  });
}

export function restoreWorkspace(repo: Repository, input: { commit: string; path?: string; revision: string }) {
  return applyPlan(repo, input);
}

export function discardWorkspace(repo: Repository, input: { path: string; revision: string }) {
  return applyPlan(repo, input);
}
