import type { WorkspaceInput } from '@ssh-server/shared';
import type { SshPool } from '../../ssh/pool';
import type { SyncManager } from '../../sync/manager';
import type { WorkspaceStore } from '../store';
import { remoteOperation } from '../../remote-files/operation';
import { createLocalDirectoryBrowser } from './local';
import { createSetupRemote, type SetupTarget } from './remote';
import { previewWorkspace } from './preview';
import type { readRcloneMetadata } from '../../sync/rclone';
import { createSetupVerification } from './verification';

export function createWorkspaceSetup(deps: {
  store: WorkspaceStore;
  pool: SshPool;
  sync: Pick<SyncManager, 'initialize' | 'status'>;
  configDir: string;
  remoteMetadata?: typeof readRcloneMetadata;
}) {
  const lifetime = new AbortController();
  const local = createLocalDirectoryBrowser();
  const remote = createSetupRemote(deps.pool);
  const verification = createSetupVerification(deps);
  const operation = <T>(parent: AbortSignal, action: (signal: AbortSignal) => Promise<T>) =>
    remoteOperation(AbortSignal.any([parent, lifetime.signal]), action);
  return {
    localDirectory: (input: { path?: string; cursor?: string }, signal: AbortSignal) =>
      operation(signal, (active) => local.list(input, active)),
    closeLocal: (cursor: string) => local.close(cursor),
    openRemote: (target: SetupTarget, signal: AbortSignal) =>
      operation(signal, (active) => remote.open(target, active)),
    readRemote: (session: string, input: { path: string; cursor?: string }, signal: AbortSignal) =>
      operation(signal, (active) => remote.list(session, input, active)),
    closeRemote: remote.close,
    remoteSize: (session: string, directory: string, signal: AbortSignal) =>
      operation(signal, (active) => remote.size(session, directory, active)),
    preview: (input: WorkspaceInput, signal: AbortSignal) =>
      operation(signal, (active) => previewWorkspace(deps, input, active)),
    verify: (input: WorkspaceInput, signal: AbortSignal) =>
      operation(signal, (active) => verification.verify(input, active)),
    // 创建前的复验受取消影响；保存后由同步管理器收尾，不设置30秒HTTP假失败。
    create: (input: Parameters<typeof verification.create>[0], signal: AbortSignal) =>
      verification.create(input, AbortSignal.any([signal, lifetime.signal])),
    revoke: (ticket: string) => verification.revoke(ticket),
    async dispose() {
      lifetime.abort();
      verification.dispose();
      remote.dispose();
      await local.dispose();
    },
  };
}
export type WorkspaceSetup = ReturnType<typeof createWorkspaceSetup>;
