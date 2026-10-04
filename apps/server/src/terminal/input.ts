import type { ClientChannel } from 'ssh2';
import { TERMINAL_LIMITS } from '@ssh-server/shared';
import { TerminalError } from './errors';

export function createTerminalInput(options: {
  channel: ClientChannel;
  notify: (paused: boolean) => void;
  fail: (error: TerminalError) => void;
}) {
  const { channel, notify, fail } = options;
  let queue: Buffer[] = [];
  let bytes = 0;
  let paused = false;
  let disposed = false;
  function flush() {
    while (!disposed && !paused && queue.length) {
      const next = queue.shift()!;
      bytes -= next.length;
      try {
        paused = !channel.write(next);
        if (paused) notify(true);
      } catch {
        fail(new TerminalError('connection_lost'));
      }
    }
  }
  const drain = () => {
    if (disposed) return;
    paused = false;
    notify(false);
    flush();
  };
  channel.on('drain', drain);
  return {
    enqueue(data: Buffer) {
      if (disposed) return;
      if (data.length > TERMINAL_LIMITS.frameBytes || bytes + data.length > TERMINAL_LIMITS.inputBytes) {
        fail(new TerminalError('input_overflow'));
        return;
      }
      queue.push(data);
      bytes += data.length;
      flush();
    },
    dispose() {
      disposed = true;
      queue = [];
      bytes = 0;
      channel.removeListener('drain', drain);
    },
  };
}
export type TerminalInput = ReturnType<typeof createTerminalInput>;
