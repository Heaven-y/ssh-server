import type { SshPool } from './pool';
import type { SshTarget } from './connection';
import { runExec } from './exec';

/** 固定只读命令独占通道；取消和超时只收尾本通道，不断开共享连接。 */
export async function executeMetadataCommand(
  pool: Pick<SshPool, 'openExec'>,
  target: SshTarget,
  input: { command: string; signal: AbortSignal; timeoutMs: number; outputCap: number },
): Promise<string> {
  const { signal } = input;
  let channel: Awaited<ReturnType<SshPool['openExec']>> | undefined;
  const close = () => channel?.close();
  signal.addEventListener('abort', close, { once: true });
  try {
    signal.throwIfAborted();
    const result = await runExec(
      async (command) => {
        channel = await pool.openExec(target, command, signal);
        channel.on('error', () => undefined);
        if (signal.aborted) {
          channel.close();
          signal.throwIfAborted();
        }
        return channel;
      },
      input.command,
      { localTimeoutMs: input.timeoutMs, outputCap: input.outputCap },
    );
    signal.throwIfAborted();
    if (result.exitCode !== 0 || result.timedOut || result.truncated)
      throw new Error('只读检查未完成，请检查目录权限、远端工具或连接');
    return result.stdout;
  } finally {
    signal.removeEventListener('abort', close);
  }
}
