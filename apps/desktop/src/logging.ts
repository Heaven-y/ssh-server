import { Console } from 'node:console';
import type { Writable } from 'node:stream';

/** 终端或验收进程先退出时，日志管道关闭不能触发 Electron 的主进程错误弹窗。 */
export function createDesktopLogger(stdout: Writable = process.stdout, stderr: Writable = process.stderr): Console {
  const onError = (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') throw error;
  };
  stdout.on('error', onError);
  stderr.on('error', onError);
  // Console 处理同步写入失败；流的异步 EPIPE 由上面的监听单独处理。
  return new Console({ stdout, stderr, ignoreErrors: true });
}
