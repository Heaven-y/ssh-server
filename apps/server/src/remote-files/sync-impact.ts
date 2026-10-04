import path from 'node:path';
import { SyncSettingsSchema, type RemoteFileActionInput, type Workspace } from '@ssh-server/shared';
import { assertCompatiblePaths, eligibleFile, excludedPath } from '../sync/filters';
import { SyncError } from '../sync/errors';
import type { RemoteActionPlan } from './executor';
import { RemoteFilesError } from './errors';
import { inside } from './paths';

type Scope = { root: string; workspace: Workspace };
type Entry = { path: string; type: string; size: number };
function syncRule({ root, workspace }: Scope) {
  const settings = SyncSettingsSchema.parse(workspace.sync ?? {});
  return (file: string, size: number, destination: boolean) => {
    if (!inside(root, file)) return false;
    const relative = path.posix.relative(root, file);
    if (size > settings.maxFileBytes || excludedPath(relative, settings)) return false;
    try {
      return eligibleFile(relative, size, settings);
    } catch (error) {
      if (!(error instanceof SyncError) || error.code !== 'unsafe_path') throw error;
      if (destination) throw new RemoteFilesError('invalid_sync_path');
      return false;
    }
  };
}

function countFiles(scope: Scope, base: string | undefined, entries: Entry[], destination = false) {
  if (!base) return 0;
  const eligible = syncRule(scope);
  const paths = new Set<string>();
  for (const entry of entries) {
    const file = path.posix.join(base, entry.path);
    if (!eligible(file, entry.size, destination)) continue;
    const key = path.posix.relative(scope.root, file);
    paths.add(key);
  }
  if (destination) checkCompatible(paths);
  return paths.size;
}
function checkCompatible(paths: Iterable<string>) {
  try {
    assertCompatiblePaths(paths);
  } catch (error) {
    if (error instanceof SyncError && error.code === 'case_collision')
      throw new RemoteFilesError('sync_case_collision');
    throw error;
  }
}

export function destinationPaths(
  workspace: Workspace,
  root: string,
  plan: RemoteActionPlan,
  action: RemoteFileActionInput,
) {
  if (!action.destination) return [];
  const eligible = syncRule({ workspace, root });
  const entries =
    plan.sourceEntries ??
    (plan.sourceType === 'file' ? [{ path: '', type: 'file', size: Number(plan.sourceFacts?.[3]) }] : []);
  return entries
    .filter((entry) => entry.type === 'file')
    .map((entry) => ({ path: path.posix.join(action.destination!, entry.path), size: entry.size }))
    .filter((entry) => eligible(entry.path, entry.size, true))
    .map((entry) => path.posix.relative(root, entry.path));
}
function workspaceImpact(scope: Scope, action: RemoteFileActionInput, entries: Entry[], complete: boolean) {
  const { root, workspace } = scope;
  const details = { id: workspace.id, name: workspace.name, remoteRoot: root };
  if (!complete)
    return [action.source, action.destination].some((file) => file && (inside(root, file) || inside(file, root)))
      ? [details]
      : [];
  const sourceFiles = countFiles(scope, action.source, entries);
  const destinationFiles = countFiles(scope, action.destination, entries, true);
  return sourceFiles || destinationFiles ? [{ ...details, sourceFiles, destinationFiles }] : [];
}

/** 只使用完整元数据清单分类，目录中被排除的正文不会为此回传本机。 */
export function syncImpact(workspaces: Workspace[], plan: RemoteActionPlan, action: RemoteFileActionInput) {
  const complete = action.kind === 'mkdir' || plan.sourceEntries !== undefined || plan.sourceType !== 'directory';
  const entries =
    plan.sourceEntries ??
    (plan.sourceType === 'file' ? [{ path: '', type: 'file' as const, size: Number(plan.sourceFacts?.[3]) }] : []);
  const files = entries.filter((entry) => entry.type === 'file');
  const affected = workspaces.flatMap((workspace, index) =>
    workspaceImpact({ root: plan.roots[index]!, workspace }, action, files, complete),
  );
  return { affected, complete };
}
