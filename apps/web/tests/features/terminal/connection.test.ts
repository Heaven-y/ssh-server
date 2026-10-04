import { afterEach, expect, it, vi } from 'vitest';
import type { TerminalTarget } from '@ssh-server/shared';
import { createTerminalConnection } from '../../../src/features/terminal/connection';
import { createTerminalPaste, prepareTerminalPaste } from '../../../src/features/terminal/paste';

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
  send(data: string) {
    this.sent.push(JSON.parse(data));
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
  Socket.instances = [];
});
const target: TerminalTarget = { workspaceId: 'w', sshHost: 'my-server', authMode: 'key', remoteDir: '/demo' };
function fixture() {
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('location', { href: 'http://localhost/', protocol: 'http:' });
  const callbacks = { output: vi.fn(), message: vi.fn(), closed: vi.fn(), availability: vi.fn() };
  const connection = createTerminalConnection({
    target,
    binding: `1.1234.${'a'.repeat(32)}.${'b'.repeat(64)}`,
    size: { cols: 80, rows: 24 },
    callbacks,
  });
  const socket = Socket.instances[0]!;
  socket.dispatchEvent(new Event('open'));
  const ready = () =>
    socket.receive(
      JSON.stringify({ type: 'ready', target, sessionId: '11111111-1111-4111-8111-111111111111', startDir: '/demo' }),
    );
  return { connection, socket, callbacks, ready };
}
it('启动期间resize在ready时补发最新尺寸，exit不被close覆盖且不重连', () => {
  const f = fixture();
  f.connection.resize({ cols: 120, rows: 30 });
  f.connection.resize({ cols: 160, rows: 40 });
  f.ready();
  expect(f.socket.sent.at(-1)).toEqual({ type: 'resize', size: { cols: 160, rows: 40 } });
  f.socket.receive(JSON.stringify({ type: 'exit', exitCode: 7, signal: null, outputComplete: true }));
  f.socket.close();
  expect(f.callbacks.closed).not.toHaveBeenCalled();
  expect(Socket.instances).toHaveLength(1);
  f.connection.close();
});
it('待发粘贴按32KiB分块，背压后只发送余量、取消丢弃旧输入', () => {
  let writable = true;
  const sent: Uint8Array[] = [];
  const changed = vi.fn();
  const paste = createTerminalPaste({
    send: (bytes) => {
      if (!writable) return false;
      sent.push(bytes);
      writable = false;
      return true;
    },
    changed,
  });
  const bytes = prepareTerminalPaste('a'.repeat(70000));
  paste.enqueue(bytes);
  expect(sent[0]).toHaveLength(32768);
  writable = true;
  paste.flush();
  expect(sent[1]).toHaveLength(32768);
  paste.cancel();
  writable = true;
  paste.flush();
  expect(sent).toHaveLength(2);
  expect(() => prepareTerminalPaste('a'.repeat(262145))).toThrow('256 KiB');
});
it('bracketed paste保留原字节，取消未发送正文后仍闭合协议边界', () => {
  let writable = true;
  const sent: Uint8Array[] = [];
  const paste = createTerminalPaste({
    send: (bytes) => {
      if (!writable) return false;
      sent.push(bytes);
      writable = false;
      return true;
    },
    changed: vi.fn(),
  });
  paste.enqueue(prepareTerminalPaste('a'.repeat(40000) + '\r\n中文'), true);
  expect(new TextDecoder().decode(sent[0]).startsWith('\x1b[200~')).toBe(true);
  paste.cancel();
  writable = true;
  paste.flush();
  expect(new TextDecoder().decode(sent.at(-1))).toBe('\x1b[201~');
});
it('二进制按消费字节确认，输入受服务端和浏览器背压限制，坏控制帧结束本连接', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const bytes = new TextEncoder().encode('中文');
  expect(f.connection.input(bytes)).toBe(false);
  f.ready();
  f.socket.receive(bytes.buffer);
  expect(f.callbacks.output).toHaveBeenCalledWith(bytes);
  f.connection.ack(bytes.length);
  expect(f.socket.sent.at(-1)).toEqual({ type: 'ack', bytes: bytes.length });
  expect(f.connection.input(bytes)).toBe(true);
  expect(f.socket.sent.at(-1)).toEqual({ type: 'input', data: btoa(String.fromCharCode(...bytes)) });
  f.socket.receive(JSON.stringify({ type: 'input-flow', paused: true }));
  expect(f.connection.input(bytes)).toBe(false);
  f.socket.bufferedAmount = 65536;
  f.socket.receive(JSON.stringify({ type: 'input-flow', paused: false }));
  expect(f.connection.input(bytes)).toBe(false);
  f.socket.bufferedAmount = 0;
  await vi.advanceTimersByTimeAsync(25);
  expect(f.callbacks.availability).toHaveBeenLastCalledWith(true);
  f.socket.receive('not-json');
  expect(f.callbacks.message).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: 'error', code: 'invalid_response' }),
  );
  expect(f.socket.readyState).toBe(3);
  expect(f.connection.input(bytes)).toBe(false);
  f.connection.close();
});
