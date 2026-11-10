import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { ProcessError, type ProcessOptions, type ProcessResult } from '../platform/process/run';

function killDirect(child: ChildProcess): void {
  try {
    child.kill('SIGKILL');
  } catch {
    /* 进程已经退出。 */
  }
}

function killWindowsTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe');
    const killer = spawn(executable, ['/PID', String(child.pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot },
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      killDirect(killer);
      killDirect(child);
    }, 5_000);
    const finish = () => {
      clearTimeout(timer);
      killDirect(child);
      resolve();
    };
    killer.once('error', finish);
    killer.once('close', finish);
  });
}

async function killTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === 'win32') return killWindowsTree(child);
  // Unix 上安装操作使用独立进程组；取消时覆盖 npm 生命周期脚本与原生安装器子进程。
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    killDirect(child);
  }
}

/** 安装操作的专用 runner：退出前等待整棵安装进程树清理完成。 */
export function runInstallationProcess(
  executable: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  if (options.signal?.aborted) return Promise.reject(new ProcessError('aborted', 'CLI 操作已取消。'));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = { stdout: [] as Buffer[], stderr: [] as Buffer[], bytes: 0 };
    let failure: ProcessError | undefined;
    let stopping: Promise<void> | undefined;
    const stop = (code: string, message: string) => {
      failure ??= new ProcessError(code, message);
      stopping ??= killTree(child);
    };
    const collect = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      output.bytes += chunk.length;
      if (output.bytes > options.outputCap) stop('output_limit', 'CLI 操作输出超过上限，已停止。');
      else output[stream].push(chunk);
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.stdin.on('error', () => undefined);
    child.once('error', () => {
      failure ??= new ProcessError('executable_missing', '无法启动安装程序，请查看官方指引。');
    });
    const timer = setTimeout(() => stop('timeout', 'CLI 安装或更新超时，已停止。'), options.timeoutMs);
    const abort = () => stop('aborted', 'CLI 操作已取消。');
    options.signal?.addEventListener('abort', abort, { once: true });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      void Promise.resolve(stopping).then(() => {
        if (failure) reject(failure);
        else resolve({ stdout: Buffer.concat(output.stdout), stderr: Buffer.concat(output.stderr), exitCode });
      });
    });
    if (options.signal?.aborted) abort();
    child.stdin.end(options.input);
  });
}
