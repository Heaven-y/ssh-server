import { createHmac, randomBytes } from 'node:crypto';
import type { BoundWorkspace } from '@agentdeck/shared/projects';
import type { RemoteBrowseTarget } from '@agentdeck/shared/ssh';
import type { SshPool } from '../../ssh/pool';
import type { WorkspaceStore } from '../../../../workspaces/store';
import { boundWorkspace } from '../../../../workspaces/bound';
import { RemoteFilesError } from './errors';

export const targetKey = (target: RemoteBrowseTarget) => JSON.stringify([target.sshHost, target.remoteDir]);
/** 工作区身份 = 绑定的服务器与默认目录；同步设置已随同步域删除。 */
export const workspaceKey = (workspace: BoundWorkspace) => JSON.stringify([workspace.server, workspace.remoteDir]);
/** 把已绑定项目投影成面板绑定快照；两边的键顺序必须与上面一致。 */
export const browseTargetOf = (workspace: BoundWorkspace): RemoteBrowseTarget => ({
  sshHost: workspace.server,
  remoteDir: workspace.remoteDir,
});

/** 核对配置、私钥摘要和认证代次，不打开SSH；令牌不暴露实际连接配置或密码。 */
export function createBrowseBinding(
  store: Pick<WorkspaceStore, 'get'>,
  pool: Pick<SshPool, 'fingerprint' | 'generation'>,
) {
  const secret = randomBytes(32);
  return async (workspaceId: string, expected: RemoteBrowseTarget, signal: AbortSignal) => {
    const workspace = boundWorkspace(await store.get(workspaceId));
    signal.throwIfAborted();
    if (!workspace) throw new RemoteFilesError('workspace_missing');
    if (workspaceKey(workspace) !== targetKey(expected)) throw new RemoteFilesError('target_changed');
    const generation = pool.generation(workspace.server);
    const identity = await pool.fingerprint(workspace.server);
    signal.throwIfAborted();
    if (generation !== pool.generation(workspace.server)) throw new RemoteFilesError('target_changed');
    const binding = createHmac('sha256', secret)
      .update(JSON.stringify([workspaceId, workspaceKey(workspace), identity, generation]))
      .digest('hex');
    return { workspace, binding };
  };
}
