import { RESOURCE_LIMITS } from '@ssh-server/shared';
import type { SshPool } from '../ssh/pool';
import type { SshTarget } from '../ssh/connection';
import { runExec } from '../ssh/exec';

/** 只关闭采样通道；取消或超时不disconnect共享SSH。 */
export async function sampleResourceCommand(
  pool: SshPool,
  target: SshTarget,
  command: string,
  options: AbortSignal | { signal: AbortSignal; timeoutMs: number },
): Promise<string> {
  const signal = 'signal' in options ? options.signal : options;
  const timeoutMs = 'signal' in options ? options.timeoutMs : RESOURCE_LIMITS.timeoutMs;
  let channel: Awaited<ReturnType<SshPool['openExec']>> | undefined;
  const close = () => channel?.close();
  signal.addEventListener('abort', close, { once: true });
  try {
    signal.throwIfAborted();
    const result = await runExec(
      async (cmd) => {
        channel = await pool.openExec(target, cmd, signal);
        channel.on('error', () => undefined);
        if (signal.aborted) {
          channel.close();
          signal.throwIfAborted();
        }
        return channel;
      },
      command,
      { localTimeoutMs: timeoutMs, outputCap: RESOURCE_LIMITS.outputBytes },
    );
    signal.throwIfAborted();
    if (result.exitCode !== 0 || result.timedOut || result.truncated) throw new Error('资源采样未完成');
    return result.stdout;
  } finally {
    signal.removeEventListener('abort', close);
  }
}
