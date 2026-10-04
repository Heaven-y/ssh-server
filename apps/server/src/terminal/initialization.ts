import { randomBytes } from 'node:crypto';
import type { ClientChannel } from 'ssh2';
import { TERMINAL_LIMITS } from '@ssh-server/shared';
import { sq } from '../ssh/remote-command';
import { TerminalError } from './errors';

export function initializeTerminal(options: {
  channel: ClientChannel;
  startDir: string;
  signal: AbortSignal;
}): Promise<{ trailing: Buffer[] }> {
  const { channel, startDir, signal } = options;
  if (!startDir.startsWith('/') || /[\r\n\0]/.test(startDir))
    return Promise.reject(new TerminalError('directory_unavailable'));
  const token = randomBytes(16).toString('hex');
  const success = Buffer.from(`\x1e${token}:ok\x1f`);
  const failure = Buffer.from(`\x1e${token}:fail\x1f`);
  // 回显中只有文字转义，实际 printf 控制字节才构成确认帧。
  const command = `if cd ${sq(startDir)}; then printf '\\036%s\\037' ${sq(`${token}:ok`)}; else printf '\\036%s\\037' ${sq(`${token}:fail`)}; exit 1; fi\n`;
  return new Promise((resolve, reject) => {
    let finished = false;
    let buffered = Buffer.alloc(0);
    let total = 0;
    const timer = setTimeout(() => stop(new TerminalError('startup_failed')), TERMINAL_LIMITS.initMs);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      channel.removeListener('data', data);
      channel.stderr.removeListener('data', stderr);
      channel.removeListener('close', closed);
      channel.removeListener('error', closed);
    };
    function stop(error: TerminalError) {
      if (finished) return;
      finished = true;
      cleanup();
      channel.on('error', () => undefined);
      channel.close();
      reject(error);
    }
    function count(bytes: Buffer) {
      total += bytes.length;
      if (total > TERMINAL_LIMITS.initBytes) stop(new TerminalError('startup_failed'));
    }
    const stderr = (bytes: Buffer) => count(bytes);
    const abort = () => stop(new TerminalError('cancelled'));
    const closed = () => stop(new TerminalError('directory_unavailable'));
    function data(bytes: Buffer) {
      count(bytes);
      if (finished) return;
      buffered = Buffer.concat([buffered, bytes]);
      if (buffered.includes(failure)) return stop(new TerminalError('directory_unavailable'));
      const index = buffered.indexOf(success);
      if (index < 0) return;
      finished = true;
      // 先暂停再移交监听，await 的微任务窗口不能丢失后续输出。
      channel.pause();
      channel.stderr.pause();
      cleanup();
      const tail = buffered.subarray(index + success.length);
      resolve({ trailing: tail.length ? [tail] : [] });
    }
    signal.addEventListener('abort', abort, { once: true });
    channel.on('data', data);
    channel.stderr.on('data', stderr);
    channel.once('close', closed);
    channel.once('error', closed);
    if (signal.aborted) abort();
    if (!finished) {
      try {
        channel.write(command);
      } catch {
        stop(new TerminalError('startup_failed'));
      }
    }
  });
}
