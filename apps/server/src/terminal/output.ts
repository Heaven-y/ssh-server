import type { ClientChannel } from 'ssh2';
import type WebSocket from 'ws';
import { TERMINAL_LIMITS } from '@ssh-server/shared';
import { TerminalError } from './errors';

type Result = { exitCode: number | null; signal: string | null };
export function createTerminalOutput(options: {
  channel: ClientChannel;
  socket: WebSocket;
  fail: (error: TerminalError) => void;
  ended: () => void;
}) {
  const { channel, socket, fail, ended } = options;
  let queue: Buffer[] = [];
  let queued = 0;
  let outstanding = 0;
  let sending = false;
  let paused = true;
  let disposed = false;
  let result: Result | undefined;
  let exiting = false;
  let consumedAt = Date.now();
  function flow() {
    const shouldPause =
      outstanding >= TERMINAL_LIMITS.outputPauseBytes || socket.bufferedAmount >= TERMINAL_LIMITS.resumeBytes;
    if (!paused && shouldPause) {
      paused = true;
      channel.pause();
      channel.stderr.pause();
    }
    if (paused && outstanding < TERMINAL_LIMITS.resumeBytes && socket.bufferedAmount < TERMINAL_LIMITS.resumeBytes) {
      paused = false;
      channel.resume();
      channel.stderr.resume();
    }
  }
  function finishExit() {
    if (!result || exiting || disposed) return;
    exiting = true;
    try {
      socket.send(JSON.stringify({ type: 'exit', ...result, outputComplete: true }), (error) => {
        if (disposed) return;
        if (error) fail(new TerminalError('output_congested'));
        else ended();
      });
    } catch {
      fail(new TerminalError('output_congested'));
    }
  }
  function pump() {
    if (disposed) return;
    flow();
    if (sending) return;
    if (!queue.length) {
      if (result) finishExit();
      return;
    }
    if (outstanding >= TERMINAL_LIMITS.outputPauseBytes || socket.bufferedAmount >= TERMINAL_LIMITS.resumeBytes) return;
    const next = queue.shift()!;
    queued -= next.length;
    outstanding += next.length;
    sending = true;
    try {
      socket.send(next, { binary: true }, (error) => {
        sending = false;
        if (disposed) return;
        if (error) fail(new TerminalError('output_congested'));
        else pump();
      });
      flow();
    } catch {
      sending = false;
      fail(new TerminalError('output_congested'));
    }
  }
  const timer = setInterval(() => {
    if (queued + outstanding && Date.now() - consumedAt >= TERMINAL_LIMITS.inactivityMs)
      fail(new TerminalError('consumer_timeout'));
    else pump();
  }, 25);
  timer.unref();
  return {
    push(data: Buffer) {
      if (disposed) return;
      if (queued + outstanding + data.length > TERMINAL_LIMITS.outputBytes) {
        fail(new TerminalError('output_congested'));
        return;
      }
      if (!queued && !outstanding) consumedAt = Date.now();
      for (let offset = 0; offset < data.length; offset += TERMINAL_LIMITS.frameBytes) {
        queue.push(Buffer.from(data.subarray(offset, offset + TERMINAL_LIMITS.frameBytes)));
      }
      queued += data.length;
      pump();
    },
    ack(bytes: number) {
      if (disposed) return;
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > outstanding) {
        fail(new TerminalError('invalid_ack'));
        return;
      }
      outstanding -= bytes;
      consumedAt = Date.now();
      pump();
    },
    finish(value: Result) {
      result = value;
      pump();
    },
    dispose() {
      disposed = true;
      clearInterval(timer);
      queue = [];
      queued = 0;
      outstanding = 0;
    },
  };
}
export type TerminalOutput = ReturnType<typeof createTerminalOutput>;
