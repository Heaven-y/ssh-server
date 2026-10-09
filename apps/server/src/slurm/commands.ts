import type { SshTarget } from '../ssh/connection';
import { runExec, type ExecResult } from '../ssh/exec';
import type { SshPool } from '../ssh/pool';
import { abortable } from './abort';

export const SLURM_LIMITS = { timeoutMs: 8000, outputBytes: 512 * 1024, lines: 200 } as const;
export const SLURM_COMMAND =
  'LC_ALL=C squeue --noheader --user="$(id -un)" --format="%.18i %.9P %.24j %.8u %.2t %.10M %.6D %R"';
type SlurmOutput = { stdout: string; warning: boolean };

export class SlurmQueryError extends Error {
  constructor(
    readonly status: 'unavailable' | 'error',
    message: string,
  ) {
    super(message);
  }
}
const timeoutError = () => new SlurmQueryError('error', 'Slurm 查询超时（8 秒），请手动重试');
const outputError = () => new SlurmQueryError('error', 'Slurm 输出超过 512 KiB，已拒绝不完整结果');

function checkResult(result: ExecResult): SlurmOutput {
  if (result.timedOut) throw timeoutError();
  if (result.truncated) throw outputError();
  if (result.exitCode === 127) throw new SlurmQueryError('unavailable', '未找到 squeue，请确认服务器已安装 Slurm');
  if (result.exitCode !== 0) throw new SlurmQueryError('error', 'Slurm 查询失败，请检查账号权限或控制器状态');
  // 成功 stderr 也可能含警告，只传递标记，不暴露原始诊断。
  return { stdout: result.stdout, warning: result.stderr.length > 0 };
}

/** 复用 SSH 池及执行收集器；只关闭本次查询通道，不断开共享连接。 */
export async function querySlurm(pool: SshPool, target: SshTarget, signal: AbortSignal): Promise<SlurmOutput> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const timer = setTimeout(() => controller.abort(timeoutError()), SLURM_LIMITS.timeoutMs);
  let channel: Awaited<ReturnType<SshPool['openExec']>> | undefined;
  let bytes = 0;
  const close = () => channel?.close();
  const count = (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > SLURM_LIMITS.outputBytes) controller.abort(outputError());
  };
  combined.addEventListener('abort', close, { once: true });
  try {
    const result = await abortable(
      runExec(
        async (command) => {
          channel = await pool.openExec(target, command, combined);
          channel.on('error', () => undefined);
          if (combined.aborted) {
            channel.close();
            combined.throwIfAborted();
          }
          channel.on('data', count);
          channel.stderr.on('data', count);
          return channel;
        },
        SLURM_COMMAND,
        { localTimeoutMs: SLURM_LIMITS.timeoutMs, outputCap: SLURM_LIMITS.outputBytes },
      ),
      combined,
    );
    combined.throwIfAborted();
    return checkResult(result);
  } catch (error) {
    close();
    combined.throwIfAborted();
    if (error instanceof SlurmQueryError) throw error;
    throw new SlurmQueryError('error', 'Slurm 查询未完成，请检查 SSH 连接后重试');
  } finally {
    clearTimeout(timer);
    combined.removeEventListener('abort', close);
    channel?.removeListener('data', count);
    channel?.stderr.removeListener('data', count);
  }
}
