// 无 shell 的异步子进程；凭据可通过 stdin/独立环境传递，错误不含参数或原始 stderr。
import { spawn } from 'node:child_process';
import { SyncError } from './errors';

export type ProcessOptions = {
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  timeoutMs: number;
  outputCap: number;
  signal?: AbortSignal;
};
export type ProcessResult = { stdout: Buffer; stderr: Buffer; exitCode: number | null };
export type ProcessRunner = typeof runProcess;

export function runProcess(executable: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let failure: SyncError | undefined;
    const stop = (code: string, message: string) => {
      failure ??= new SyncError(code, message);
      child.kill('SIGKILL');
    };
    const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > options.outputCap) stop('output_limit', '同步子进程输出超限，已停止');
      else chunks.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.stdin.on('error', () => undefined);
    child.once('error', () => {
      failure ??= new SyncError('executable_missing', '无法启动同步程序，请配置本机 rclone 1.75.1');
    });
    const timer = setTimeout(() => stop('timeout', '同步超时，已停止；请检查连接后恢复'), options.timeoutMs);
    const abort = () => stop('aborted', '同步已取消');
    options.signal?.addEventListener('abort', abort, { once: true });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode });
    });
    if (options.signal?.aborted) abort();
    child.stdin.end(options.input);
  });
}
