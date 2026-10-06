import { createHmac, randomBytes } from 'node:crypto';
import { SyncSettingsSchema, type RemoteBrowseTarget, type Workspace } from '@ssh-server/shared';
import type { SshPool } from '../ssh/pool';
import { workspaceTarget } from '../ssh/connection';
import type { WorkspaceStore } from '../workspaces/store';
import { RemoteFilesError } from './errors';

export const targetKey = (target: RemoteBrowseTarget) =>
  JSON.stringify([target.sshHost, workspaceTarget(target).authMode, target.remoteDir, target.localDir]);
export const workspaceKey = (workspace: Workspace) =>
  JSON.stringify([targetKey(workspace), SyncSettingsSchema.parse(workspace.sync ?? {})]);

/** 仅登记配置身份，不读取私钥/密码或打开 SSH；令牌不暴露实际连接配置。 */
export function createBrowseBinding(store: Pick<WorkspaceStore, 'get'>, pool: Pick<SshPool, 'fingerprint'>) {
  const secret = randomBytes(32);
  return async (workspaceId: string, expected: RemoteBrowseTarget, signal: AbortSignal) => {
    const workspace = await store.get(workspaceId);
    signal.throwIfAborted();
    if (!workspace) throw new RemoteFilesError('workspace_missing');
    if (targetKey(workspace) !== targetKey(expected)) throw new RemoteFilesError('target_changed');
    const identity = await pool.fingerprint(workspace.sshHost);
    signal.throwIfAborted();
    const binding = createHmac('sha256', secret)
      .update(JSON.stringify([workspaceId, workspaceKey(workspace), identity]))
      .digest('hex');
    return { workspace, binding };
  };
}
