import {
  TERMINAL_LIMITS,
  TerminalClientMessageSchema,
  TerminalServerMessageSchema,
  terminalTargetKey,
  type TerminalTarget,
  type TerminalSize,
  type TerminalClientMessage,
  type TerminalServerMessage,
} from '@ssh-server/shared';

type Callbacks = {
  output: (bytes: Uint8Array) => void;
  message: (message: TerminalServerMessage) => void;
  closed: () => void;
  availability: (available: boolean) => void;
};
export function createTerminalConnection(options: {
  target: TerminalTarget;
  binding: string;
  size: TerminalSize;
  callbacks: Callbacks;
}) {
  const { target, binding, size, callbacks } = options;
  const url = new URL(`/api/workspaces/${encodeURIComponent(target.workspaceId)}/terminal`, location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  let ready = false;
  let paused = false;
  let ended = false;
  let disposed = false;
  let available = false;
  let pendingSize = size;
  let sentSize = size;
  function resizePending() {
    if (!ready || ended || (pendingSize.cols === sentSize.cols && pendingSize.rows === sentSize.rows)) return;
    if (send({ type: 'resize', size: pendingSize })) sentSize = pendingSize;
  }
  function canInput() {
    return (
      ready &&
      !paused &&
      !ended &&
      !disposed &&
      socket.readyState === WebSocket.OPEN &&
      socket.bufferedAmount < TERMINAL_LIMITS.resumeBytes
    );
  }
  function report() {
    const next = canInput();
    if (next !== available) {
      available = next;
      callbacks.availability(next);
    }
  }
  function send(message: TerminalClientMessage): boolean {
    if (disposed || socket.readyState !== WebSocket.OPEN) return false;
    if (!TerminalClientMessageSchema.safeParse(message).success) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }
  function failure() {
    if (ended || disposed) return;
    ended = true;
    ready = false;
    callbacks.message({ type: 'error', code: 'invalid_response', message: '终端连接异常，已停止本次输入，请新建连接' });
    report();
    socket.close();
  }
  socket.addEventListener('open', () => {
    if (disposed) {
      socket.close();
      return;
    }
    if (!send({ type: 'open', target, binding, size })) failure();
  });
  function control(value: unknown) {
    const parsed = TerminalServerMessageSchema.safeParse(value);
    if (!parsed.success) {
      failure();
      return;
    }
    const message = parsed.data;
    if (ended) return;
    if (message.type === 'ready') {
      if (ready || terminalTargetKey(message.target) !== terminalTargetKey(target)) {
        failure();
        return;
      }
      ready = true;
      resizePending();
    }
    if (message.type === 'input-flow') paused = message.paused;
    if (message.type === 'exit' || message.type === 'error') {
      ended = true;
      ready = false;
    }
    callbacks.message(message);
    report();
  }
  socket.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (disposed || ended) return;
    if (event.data instanceof ArrayBuffer) {
      if (!ready || event.data.byteLength > TERMINAL_LIMITS.frameBytes) {
        failure();
        return;
      }
      callbacks.output(new Uint8Array(event.data));
    } else if (typeof event.data === 'string') {
      try {
        control(JSON.parse(event.data));
      } catch {
        failure();
      }
    } else failure();
  });
  const closed = () => {
    if (!ended && !disposed) {
      ended = true;
      ready = false;
      callbacks.closed();
    }
    report();
    clearInterval(timer);
  };
  socket.addEventListener('close', closed);
  socket.addEventListener('error', closed);
  const timer = setInterval(report, 25);
  return {
    input(bytes: Uint8Array): boolean {
      if (!bytes.length || bytes.length > TERMINAL_LIMITS.frameBytes || !canInput()) {
        report();
        return false;
      }
      const data = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
      const sent = send({ type: 'input', data });
      report();
      return sent;
    },
    resize(next: TerminalSize) {
      pendingSize = next;
      resizePending();
    },
    ack(bytes: number) {
      if (!disposed) send({ type: 'ack', bytes });
    },
    close() {
      if (disposed) return;
      send({ type: 'close' });
      disposed = true;
      ready = false;
      clearInterval(timer);
      socket.close();
    },
  };
}
export type TerminalConnection = ReturnType<typeof createTerminalConnection>;
