import { RESOURCE_LIMITS, SSH_CONSOLE_LIMITS, SshConsolePathSchema, type SshConsoleDisk } from '@agentdeck/shared/ssh';
import { ResourceCache } from '../legacy/resources/cache';
import { CONSOLE_HOST_COMMAND, CONSOLE_DISK_COMMAND, parseConsoleHost, parseConsoleDisks } from './overview';
import { runExec } from '../ssh/exec';
import type { SshPool } from '../ssh/pool';
import type { ConsoleAccess, ConsoleLease } from './access';
import { SshConsoleError } from './errors';
import { CONSOLE_PROCESS_COMMAND, parseConsoleProcesses, type ConsoleProcessData } from './processes';

const timing = {
  ...RESOURCE_LIMITS,
  intervalMs: SSH_CONSOLE_LIMITS.refreshMs,
  timeoutMs: SSH_CONSOLE_LIMITS.metricsTimeoutMs,
};
type Host = ReturnType<typeof parseConsoleHost>;
const keyOf = (lease: ConsoleLease) =>
  JSON.stringify([lease.target.alias, lease.guard.generation, lease.guard.cacheKey]);
async function sample(pool: SshPool, lease: ConsoleLease, command: string, signal: AbortSignal) {
  const combined = AbortSignal.any([lease.signal, signal]);
  let channel: Awaited<ReturnType<SshPool['openExec']>> | undefined;
  const cancel = () => channel?.close();
  combined.addEventListener('abort', cancel, { once: true });
  try {
    lease.check();
    combined.throwIfAborted();
    const result = await runExec(
      async (text) => {
        channel = await pool.openExec(lease.target, text, combined);
        channel.on('error', () => undefined);
        if (combined.aborted) {
          channel.close();
          combined.throwIfAborted();
        }
        return channel;
      },
      command,
      { localTimeoutMs: timing.timeoutMs, outputCap: 512 * 1024 },
    );
    combined.throwIfAborted();
    await lease.recheck();
    if (result.exitCode !== 0 || result.timedOut || result.truncated) throw new SshConsoleError('operation_failed');
    return result.stdout;
  } finally {
    combined.removeEventListener('abort', cancel);
    channel?.close();
  }
}

export function createConsoleMetrics(pool: SshPool, access: ConsoleAccess) {
  let hosts = new ResourceCache<Host>(64);
  let disks = new ResourceCache<SshConsoleDisk[]>(64);
  let processes = new ResourceCache<ConsoleProcessData>(64);
  return {
    async overview(serverId: string, remoteDir = '~', signal?: AbortSignal) {
      if (!SshConsolePathSchema.safeParse(remoteDir).success) throw new SshConsoleError('invalid_request');
      const lease = await access.capture(serverId, signal);
      try {
        const key = keyOf(lease);
        const [host, disk] = await Promise.all([
          hosts.get(
            key,
            async (previous, abort) =>
              parseConsoleHost(await sample(pool, lease, CONSOLE_HOST_COMMAND, abort), previous?.cpu),
            timing,
          ),
          disks.get(
            key,
            async (_previous, abort) => parseConsoleDisks(await sample(pool, lease, CONSOLE_DISK_COMMAND, abort)),
            timing,
          ),
        ]);
        await lease.recheck();
        return { serverId, remoteDir, host: { ...host, data: host.data?.data ?? null }, disk };
      } finally {
        lease.close();
      }
    },
    async processes(serverId: string, signal?: AbortSignal) {
      const lease = await access.capture(serverId, signal);
      try {
        const result = await processes.get(
          keyOf(lease),
          async (_previous, abort) => parseConsoleProcesses(await sample(pool, lease, CONSOLE_PROCESS_COMMAND, abort)),
          timing,
        );
        await lease.recheck();
        return {
          serverId,
          sampledAt: result.sampledAt,
          stale: result.stale,
          message: result.message,
          ...(result.data ?? { processes: [], gpuProcesses: [], gpuProcessesAvailable: false, truncated: false }),
        };
      } finally {
        lease.close();
      }
    },
    dispose() {
      hosts.dispose();
      disks.dispose();
      processes.dispose();
      hosts = new ResourceCache<Host>(64);
      disks = new ResourceCache<SshConsoleDisk[]>(64);
      processes = new ResourceCache<ConsoleProcessData>(64);
    },
  };
}
