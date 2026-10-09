import {
  RESOURCE_LIMITS,
  resourceTiming,
  type ResourceHost,
  type ResourceDisk,
  type ResourceSnapshot,
  type TerminalTarget,
  type ResourceTiming,
  type ProductSettings,
} from '@ssh-server/shared';
import { workspaceTarget } from '../ssh/connection';
import type { SshPool } from '../ssh/pool';
import type { WorkspaceStore } from '../workspaces/store';
import { ResourceCache } from './cache';
import { HOST_RESOURCE_COMMAND, diskResourceCommand } from './commands';
import { parseHostResources, parseDiskResources, type CpuCounters } from './parse';
import { sampleResourceCommand } from './sample';
import { createResourceTargetContext, ResourceTargetError, type ResourceTargetContext } from './target';
export { ResourceTargetError } from './target';

type HostSample = { data: ResourceHost; cpu?: CpuCounters };
export function createResourcesService({
  store,
  pool,
  settings,
}: {
  store: Pick<WorkspaceStore, 'get'>;
  pool: SshPool;
  settings?: () => Promise<ProductSettings>;
}) {
  const hosts = new ResourceCache<HostSample>(RESOURCE_LIMITS.hostEntries);
  const disks = new ResourceCache<ResourceDisk>(RESOURCE_LIMITS.diskEntries);
  const context = createResourceTargetContext({ store, pool });
  async function sample(
    target: TerminalTarget,
    expected: ResourceTargetContext,
    command: string,
    options: { signal: AbortSignal; timing: ResourceTiming },
  ) {
    const controller = new AbortController();
    const detach = pool.onCredentialsChanged(target.sshHost, () => controller.abort());
    const combined = AbortSignal.any([options.signal, controller.signal]);
    try {
      const checked = await context(target, expected);
      combined.throwIfAborted();
      const text = await sampleResourceCommand(pool, workspaceTarget(checked.workspace), command, {
        signal: combined,
        timeoutMs: options.timing.timeoutMs,
      });
      await context(target, checked);
      combined.throwIfAborted();
      if (pool.generation(target.sshHost) !== checked.generation) throw new ResourceTargetError('target_changed');
      return text;
    } finally {
      detach();
    }
  }
  return {
    async get(target: TerminalTarget): Promise<ResourceSnapshot> {
      const timing = settings ? resourceTiming((await settings()).resources) : RESOURCE_LIMITS;
      const expected = await context(target);
      const { samplingKey } = expected;
      const [host, disk] = await Promise.all([
        hosts.get(
          samplingKey,
          async (previous, signal) =>
            parseHostResources(
              await sample(target, expected, HOST_RESOURCE_COMMAND, { signal, timing }),
              previous?.cpu,
            ),
          timing,
        ),
        disks.get(
          JSON.stringify([samplingKey, target.remoteDir]),
          async (_previous, signal) =>
            parseDiskResources(
              await sample(target, expected, diskResourceCommand(target.remoteDir), { signal, timing }),
            ),
          timing,
        ),
      ]);
      await context(target, expected);
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
