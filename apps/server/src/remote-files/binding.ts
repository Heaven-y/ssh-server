import { createHmac, randomBytes } from 'node:crypto';
import { SyncSettingsSchema, type RemoteBrowseTarget, type Workspace } from '@ssh-server/shared';
import type { SshPool } from '../ssh/pool';
import type { WorkspaceStore } from '../workspaces/store';
import { RemoteFilesError } from './errors';

export const targetKey = (target: RemoteBrowseTarget) =>
  JSON.stringify([target.sshHost, target.remoteDir, target.localDir]);
export const workspaceKey = (workspace: Workspace) =>
  JSON.stringify([targetKey(workspace), SyncSettingsSchema.parse(workspace.sync ?? {})]);

/** 核对配置、私钥摘要和认证代次，不打开SSH；令牌不暴露实际连接配置或密码。 */
export function createBrowseBinding(
  store: Pick<WorkspaceStore, 'get'>,
  pool: Pick<SshPool, 'fingerprint' | 'generation'>,
) {
  const secret = randomBytes(32);
  return async (workspaceId: string, expected: RemoteBrowseTarget, signal: AbortSignal) => {
    const workspace = await store.get(workspaceId);
    signal.throwIfAborted();
    if (!workspace) throw new RemoteFilesError('workspace_missing');
    if (targetKey(workspace) !== targetKey(expected)) throw new RemoteFilesError('target_changed');
    const generation = pool.generation(workspace.sshHost);
    const identity = await pool.fingerprint(workspace.sshHost);
    signal.throwIfAborted();
    if (generation !== pool.generation(workspace.sshHost)) throw new RemoteFilesError('target_changed');
    const binding = createHmac('sha256', secret)
      .update(JSON.stringify([workspaceId, workspaceKey(workspace), identity, generation]))
      .digest('hex');
    return { workspace, binding };
  };
}
