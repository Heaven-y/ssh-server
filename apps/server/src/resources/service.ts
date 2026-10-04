import {
  RESOURCE_LIMITS,
  terminalTargetKey,
  workspaceTerminalTarget,
  type ResourceHost,
  type ResourceDisk,
  type ResourceSnapshot,
  type TerminalTarget,
} from '@ssh-server/shared';
import { createHash } from 'node:crypto';
import { workspaceTarget, type ResolvedConnection } from '../ssh/connection';
import type { SshPool } from '../ssh/pool';
import type { WorkspaceStore } from '../workspaces/store';
import { ResourceCache } from './cache';
import { HOST_RESOURCE_COMMAND, diskResourceCommand } from './commands';
import { parseHostResources, parseDiskResources, type CpuCounters } from './parse';
import { sampleResourceCommand } from './sample';

export class ResourceTargetError extends Error {
  constructor(readonly code: 'workspace_missing' | 'target_changed') {
    super(code === 'workspace_missing' ? '工作区不存在' : '工作区连接或目录已变化，请关闭资源面板后重新打开');
  }
}
type HostSample = { data: ResourceHost; cpu?: CpuCounters };
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
/** pool的cacheKey保留alias；采样按实际目标与认证共享，不返回该摘要。 */
function samplingKey(connection: ResolvedConnection): string {
  const auth = connection.authMode === 'key' ? connection.privateKey : connection.password;
  return digest(
    JSON.stringify([
      connection.hostname,
      connection.port,
      connection.username,
      connection.authMode,
      digest(auth ?? ''),
      digest(connection.knownHosts),
    ]),
  );
}
export function createResourcesService({ store, pool }: { store: Pick<WorkspaceStore, 'get'>; pool: SshPool }) {
  const hosts = new ResourceCache<HostSample>(RESOURCE_LIMITS.hostEntries);
  const disks = new ResourceCache<ResourceDisk>(RESOURCE_LIMITS.diskEntries);
  async function checkedWorkspace(target: TerminalTarget) {
    const workspace = await store.get(target.workspaceId);
    if (!workspace) throw new ResourceTargetError('workspace_missing');
    if (terminalTargetKey(workspaceTerminalTarget(workspace)) !== terminalTargetKey(target))
      throw new ResourceTargetError('target_changed');
    return workspace;
  }
  async function context(target: TerminalTarget, expectedKey?: string) {
    const workspace = await checkedWorkspace(target);
    const generation = pool.generation(workspace.sshHost);
    const connection = await pool.resolveConnection(workspaceTarget(workspace));
    if (expectedKey && connection.cacheKey !== expectedKey) throw new ResourceTargetError('target_changed');
    // 解析会异步读取配置/凭据；不能继续使用解析前的工作区事实。
    const current = await checkedWorkspace(target);
    if (pool.generation(workspace.sshHost) !== generation) throw new ResourceTargetError('target_changed');
    return {
      workspace: current,
      key: connection.cacheKey,
      samplingKey: samplingKey(connection),
      generation,
    };
  }
  async function sample(target: TerminalTarget, key: string, command: string, signal: AbortSignal) {
    const controller = new AbortController();
    const detach = pool.onCredentialsChanged(target.sshHost, () => controller.abort());
    const combined = AbortSignal.any([signal, controller.signal]);
    try {
      const checked = await context(target, key);
      combined.throwIfAborted();
      const text = await sampleResourceCommand(pool, workspaceTarget(checked.workspace), command, combined);
      await context(target, key);
      combined.throwIfAborted();
      if (pool.generation(target.sshHost) !== checked.generation) throw new ResourceTargetError('target_changed');
      return text;
    } finally {
      detach();
    }
  }
  return {
    async get(target: TerminalTarget): Promise<ResourceSnapshot> {
      const { key, samplingKey } = await context(target);
      const [host, disk] = await Promise.all([
        hosts.get(samplingKey, async (previous, signal) =>
          parseHostResources(await sample(target, key, HOST_RESOURCE_COMMAND, signal), previous?.cpu),
        ),
        disks.get(JSON.stringify([samplingKey, target.remoteDir]), async (_previous, signal) =>
          parseDiskResources(await sample(target, key, diskResourceCommand(target.remoteDir), signal)),
        ),
      ]);
      await context(target, key);
      return {
        workspaceId: target.workspaceId,
        sshHost: target.sshHost,
        remoteDir: target.remoteDir,
        host: { ...host, data: host.data?.data ?? null },
        disk,
      };
    },
    dispose() {
      hosts.dispose();
      disks.dispose();
    },
  };
}
export type ResourcesService = ReturnType<typeof createResourcesService>;
