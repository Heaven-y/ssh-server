import { ApiError } from '../../../lib/http';
import type { SshConsoleTerminalRead } from '@agentdeck/shared/ssh';
import { sshConsoleApi } from './api';

import { consoleError } from './console-state';

export function terminalBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function terminalBytes(data: string) {
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
}
type Options = {
  serverId: string;
  terminalId: string;
  output(bytes: Uint8Array, reset: boolean): Promise<void>;
  state(value: SshConsoleTerminalRead): void;
  error(message: string): void;
  availability(ready: boolean): void;
};

/** 短轮询只推进已消费的 nextSeq；隐藏或卸载只释放浏览器资源，PTY 留在后端。 */
export function createConsoleTerminalConnection(options: Options) {
  let visible = false;
  let disposed = false;
  let exited = false;
  let paused = true;
  let stopped = false;
  let delay = 120;
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reading: AbortController | undefined;
  let writing = false;
  const queue: Uint8Array[] = [];
  let queuedBytes = 0;
  const writable = () => !disposed && !paused && !exited;
  const available = () => visible && writable();
  const canRead = () => visible && !disposed && !exited && !stopped;
  const validRead = (controller: AbortController) => !controller.signal.aborted && !disposed;
  function failedRead(reason: unknown) {
    stopped =
      reason instanceof ApiError &&
      ([400, 403, 404].includes(reason.status) || ['target_changed', 'cancelled'].includes(reason.code ?? ''));
    delay = Math.min(10000, Math.max(1000, delay * 2));
    paused = true;
    options.availability(false);
    options.error(consoleError(reason));
  }
  async function consume(response: SshConsoleTerminalRead) {
    await options.output(terminalBytes(response.data), response.reset);
    if (disposed) return;
    cursor = response.nextSeq;
    delay = 120;
    paused = response.inputPaused || response.exited;
    exited = response.exited && response.nextSeq >= response.seq;
    options.state(response);
    options.availability(available());
    void flush();
  }
  async function flush() {
    if (writing || !writable()) return;
    writing = true;
    try {
      while (queue.length && writable()) {
        const chunk = queue.shift()!;
        queuedBytes -= chunk.length;
        const result = await sshConsoleApi.inputTerminal(options.serverId, options.terminalId, terminalBase64(chunk));
        if (result.written !== chunk.length) throw new Error('输入确认不完整');
      }
    } catch {
      queue.length = 0;
      queuedBytes = 0;
      options.error('终端输入发送失败，尚未确认的输入不会重发。请检查终端状态。');
    } finally {
      writing = false;
    }
  }
  async function poll() {
    timer = undefined;
    if (!canRead() || reading) return;
    const controller = new AbortController();
    reading = controller;
    try {
      const response = await sshConsoleApi.readTerminal(
        options.serverId,
        options.terminalId,
        cursor,
        controller.signal,
      );
      if (!validRead(controller)) return;
      await consume(response);
    } catch (reason) {
      if (validRead(controller)) failedRead(reason);
    } finally {
      reading = undefined;
      if (canRead()) timer = setTimeout(() => void poll(), delay);
    }
  }
  return {
    setVisible(value: boolean) {
      if (value && !visible) stopped = false;
      visible = value;
      if (!value) {
        clearTimeout(timer);
        timer = undefined;
        reading?.abort();
      } else if (!reading && !timer) void poll();
      options.availability(available());
    },
    input(bytes: Uint8Array) {
      if (!available() || queuedBytes + bytes.length > 256 * 1024) return false;
      for (let offset = 0; offset < bytes.length; offset += 32768) queue.push(bytes.slice(offset, offset + 32768));
      queuedBytes += bytes.length;
      void flush();
      return true;
    },
    resize(size: { cols: number; rows: number }) {
      if (!visible || disposed || exited) return;
      void sshConsoleApi.resizeTerminal(options.serverId, options.terminalId, size).catch(() => {
        if (!disposed) options.error('终端尺寸同步失败，重新调整窗格后再试。');
      });
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      reading?.abort();
      queue.length = 0;
      queuedBytes = 0;
    },
  };
}
