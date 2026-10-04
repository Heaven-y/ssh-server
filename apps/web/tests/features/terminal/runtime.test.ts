import { afterEach, expect, it, vi } from 'vitest';
import { createTerminalRuntime } from '../../../src/features/terminal/runtime';

// 只替换渲染器与浏览器I/O；runtime和WS协议仍走产品实现。
const xterm = vi.hoisted(() => {
  const instances: Terminal[] = [];
  class Terminal {
    cols = 80;
    rows = 24;
    options = { disableStdin: true };
    modes = { bracketedPasteMode: true };
    parser = { registerOscHandler: vi.fn((_code: number, _handler: () => boolean) => ({ dispose: vi.fn() })) };
    data?: (text: string) => void;
    binary?: (text: string) => void;
    key?: (event: KeyboardEvent) => boolean;
    written: Uint8Array[] = [];
    consumed: Array<() => void> = [];
    constructor() {
      instances.push(this);
    }
    loadAddon = vi.fn();
    open = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    getSelection = vi.fn(() => '中文选中');
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
    }
    write(bytes: Uint8Array, done: () => void) {
      this.written.push(bytes);
      this.consumed.push(done);
    }
    onData(listener: (text: string) => void) {
      this.data = listener;
      return { dispose: vi.fn() };
    }
    onBinary(listener: (text: string) => void) {
      this.binary = listener;
      return { dispose: vi.fn() };
    }
    attachCustomKeyEventHandler(listener: (event: KeyboardEvent) => boolean) {
      this.key = listener;
    }
  }
  return { Terminal, instances };
});
vi.mock('@xterm/xterm', () => ({ Terminal: xterm.Terminal }));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

class Socket extends EventTarget {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  binaryType = '';
  sent: unknown[] = [];
  constructor(_url: URL) {
    super();
    Socket.instances.push(this);
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
  receive(data: unknown) {
    this.dispatchEvent(Object.assign(new Event('message'), { data }));
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  xterm.instances.splice(0);
  Socket.instances = [];
});
function fixture() {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('location', { href: 'http://localhost/', protocol: 'http:' });
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  const observers: Array<() => void> = [];
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  const clipboard = {
    readText: vi.fn(async () => '粘贴\r\n正文'),
    writeText: vi.fn(async (_text: string) => undefined),
  };
  vi.stubGlobal('navigator', { clipboard });
  const host = Object.assign(new EventTarget(), { clientWidth: 1000, clientHeight: 300 }) as unknown as HTMLElement;
  const target = { workspaceId: 'w', sshHost: 'my-server', authMode: 'key' as const, remoteDir: '/demo' };
  const options = {
    host,
    target,
    binding: `1.1234.${'a'.repeat(32)}.${'b'.repeat(64)}`,
    status: vi.fn(),
    paste: vi.fn(),
    notice: vi.fn(),
    pending: vi.fn(),
  };
  const frame = () => {
    const current = [...frames.values()];
    frames.clear();
    for (const callback of current) callback(0);
  };
  const ready = () =>
    Socket.instances[0]!.receive(
      JSON.stringify({ type: 'ready', target, sessionId: '11111111-1111-4111-8111-111111111111', startDir: '/demo' }),
    );
  return { options, frame, ready, host, observers, disconnect, clipboard };
}
it('非零可见尺寸才开启WS，启动期fit补发尺寸，隐藏保留实例，消费后才ack', () => {
  const f = fixture();
  const first = createTerminalRuntime(f.options);
  first.setVisible(true);
  first.dispose();
  f.frame();
  expect(Socket.instances).toHaveLength(0);
  const runtime = createTerminalRuntime(f.options);
  try {
    runtime.setVisible(true);
    f.frame();
    const socket = Socket.instances[0]!;
    socket.dispatchEvent(new Event('open'));
    const terminal = xterm.instances.at(-1)!;
    terminal.cols = 160;
    terminal.rows = 40;
    f.observers.at(-1)!();
    f.frame();
    f.ready();
    expect(socket.sent.at(-1)).toEqual({ type: 'resize', size: { cols: 160, rows: 40 } });
    const bytes = new TextEncoder().encode('中文');
    socket.receive(bytes.buffer);
    expect(terminal.written[0]).toEqual(bytes);
    expect(socket.sent.some((message) => (message as { type: string }).type === 'ack')).toBe(false);
    terminal.consumed[0]!();
    expect(socket.sent.at(-1)).toEqual({ type: 'ack', bytes: bytes.length });
    runtime.setVisible(false);
    Object.assign(f.host, { clientWidth: 0, clientHeight: 0 });
    f.observers.at(-1)!();
    f.frame();
    expect(Socket.instances).toHaveLength(1);
    expect(socket.sent.at(-1)).toEqual({ type: 'ack', bytes: bytes.length });
    runtime.setVisible(true);
    f.frame();
    expect(Socket.instances).toHaveLength(1);
  } finally {
    runtime.dispose();
  }
  expect(f.disconnect).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
it('剪贴板仅经用户触发，IME不拦快捷键，粘贴使用当前模式并保留字节', async () => {
  const f = fixture();
  const runtime = createTerminalRuntime(f.options);
  runtime.setVisible(true);
  f.frame();
  const socket = Socket.instances[0]!;
  socket.dispatchEvent(new Event('open'));
  f.ready();
  const terminal = xterm.instances[0]!;
  try {
    runtime.focus();
    await runtime.copy();
    expect(f.clipboard.writeText).toHaveBeenCalledWith('中文选中');
    f.host.dispatchEvent(new Event('compositionstart'));
    const key = {
      type: 'keydown',
      ctrlKey: true,
      shiftKey: true,
      key: 'v',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    expect(terminal.key!(key)).toBe(true);
    expect(f.clipboard.readText).not.toHaveBeenCalled();
    f.host.dispatchEvent(new Event('compositionend'));
    expect(terminal.key!(key)).toBe(false);
    await Promise.resolve();
    expect(f.options.paste).toHaveBeenCalledWith('粘贴\r\n正文');
    expect(socket.sent.some((message) => (message as { type: string }).type === 'input')).toBe(false);
    runtime.paste('中文\r\n');
    const message = socket.sent.at(-1) as { data: string };
    const expected = new TextEncoder().encode('\x1b[200~中文\r\n\x1b[201~');
    expect(atob(message.data)).toBe(String.fromCharCode(...expected));
    terminal.data!('a');
    terminal.binary!('\xff');
    expect(socket.sent.at(-1)).toEqual({ type: 'input', data: '/w==' });
    expect(terminal.parser.registerOscHandler.mock.calls[0]?.[0]).toBe(52);
    f.clipboard.readText.mockRejectedValueOnce(new Error('denied'));
    await runtime.readClipboard();
    expect(f.options.notice).toHaveBeenCalledWith(expect.stringContaining('无法读取'));
    socket.close();
    expect(f.options.status).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'disconnected' }));
    runtime.cancelPaste();
  } finally {
    runtime.dispose();
  }
});
