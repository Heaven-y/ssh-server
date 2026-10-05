import {
  VERSION_MESSAGE_MAX_LENGTH,
  type VersionRestoreInput,
  type VersionSaveInput,
  type VersionStatus,
  type TurnSnapshot,
  type Workspace,
} from '@ssh-server/shared';
import { versionOperation, VersionError } from './errors';
import { commitInfo, diff, history } from './history';
import { commitWorkspace } from './index';
import { commitId, repository, sha256, type Repository } from './repository';
import { discardPlan, discardWorkspace, restorePlan, restoreWorkspace } from './restore';
import { snapshot } from './snapshot';
import { captureTurn, diffTurn, releaseTurn } from './turn-snapshots';

export function createVersionsService() {
  const queues = new Map<string, Promise<unknown>>();
  function serial<T>(repo: Repository, operation: () => Promise<T>): Promise<T> {
    const key = process.platform === 'win32' ? repo.commonDir.toLowerCase() : repo.commonDir;
    const run = (queues.get(key) ?? Promise.resolve()).then(operation, operation);
    queues.set(key, run);
    void run
      .finally(() => {
        if (queues.get(key) === run) queues.delete(key);
      })
      .catch(() => undefined);
    return run;
  }
  async function required(ws: Workspace): Promise<Repository> {
    const repo = await repository(ws);
    if (!repo) throw new VersionError('not_initialized');
    return repo;
  }
  return {
    previewDiscard(ws: Workspace, path: string) {
      return versionOperation(async () => {
        const repo = await required(ws);
        return serial(repo, async () => {
          const plan = await discardPlan(repo, path);
          const { commit: _commit, ...preview } = plan.preview;
          return { ...preview, path, head: plan.state.head };
        });
      });
    },
    discard(ws: Workspace, input: { path: string; revision: string }) {
      return versionOperation(async () => {
        const repo = await required(ws);
        return serial(repo, () => discardWorkspace(repo, input));
      });
    },
    captureTurn(ws: Workspace, turnId: string, edge: TurnSnapshot['edge']) {
      return versionOperation(async () => {
        const repo = await required(ws);
        return serial(repo, () => captureTurn(repo, turnId, edge));
      });
    },
    diffTurn(ws: Workspace, base: TurnSnapshot, result: TurnSnapshot, path?: string) {
      return versionOperation(async () => {
        const repo = await required(ws);
        return serial(repo, () => diffTurn(repo, base, result, path));
      });
    },
    releaseTurn(ws: Workspace, snapshots: TurnSnapshot[]) {
      return versionOperation(async () => {
        const repo = await required(ws);
        return serial(repo, () => releaseTurn(repo, snapshots));
      });
    },
    initialize(ws: Workspace): Promise<VersionStatus> {
      return versionOperation(async () => {
        const repo = await repository(ws, true);
        if (!repo) throw new VersionError('not_initialized');
        return serial(repo, async () => (await snapshot(repo)).status);
      });
    },
    status(ws: Workspace): Promise<VersionStatus> {
      return versionOperation(async () => {
        const repo = await repository(ws);
        return repo
          ? serial(repo, async () => (await snapshot(repo)).status)
          : { initialized: false, revision: sha256(ws.localDir), changes: [], excluded: [] };
      });
    },
    history(ws: Workspace, skip = 0) {
      return versionOperation(async () => history(await required(ws), skip));
    },
    diff(ws: Workspace, input: { commit?: string; path?: string } = {}) {
      return versionOperation(async () => {
        const repo = await required(ws);
        return serial(repo, () => diff(repo, input));
      });
    },
    save(ws: Workspace, input: VersionSaveInput) {
      return versionOperation(async () => {
        const message = input.message.trim();
        if (!message || message.length > VERSION_MESSAGE_MAX_LENGTH || /[\r\n\0]/.test(message))
          throw new VersionError('invalid_request');
        const repo = await required(ws);
        return serial(repo, async () => {
          const state = await snapshot(repo);
          if (state.status.revision !== input.revision) throw new VersionError('stale_revision');
          const id = await commitWorkspace(state, message);
          try {
            return {
              created: !!id,
              commit: id ? await commitInfo(repo, id) : undefined,
              status: (await snapshot(repo)).status,
            };
          } catch (error) {
            if (id) throw new VersionError('partial_save');
            throw error;
          }
        });
      });
    },
    previewRestore(ws: Workspace, input: VersionRestoreInput) {
      return versionOperation(async () => {
        const repo = await required(ws);
        return serial(
          repo,
          async () => (await restorePlan(repo, await commitId(repo, input.commit), input.path)).preview,
        );
      });
    },
    restore(ws: Workspace, input: VersionRestoreInput & { revision: string }) {
      return versionOperation(async () => {
        const repo = await required(ws);
        return serial(repo, async () =>
          restoreWorkspace(repo, { ...input, commit: await commitId(repo, input.commit) }),
        );
      });
    },
  };
}

export type VersionsService = ReturnType<typeof createVersionsService>;
