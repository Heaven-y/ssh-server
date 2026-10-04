import { afterEach, expect, it, vi } from 'vitest';
import type { FileEditorMessage, FileEditorServerMessage } from '@ssh-server/shared';
import { createEditorConnection } from '../../../src/features/files/editor-connection';

class FixtureSocket {
  static OPEN = 1;
  static instances: FixtureSocket[] = [];
  readyState = 1;
  onmessage?: (event: MessageEvent<string>) => void;
  onclose?: () => void;
  onerror?: () => void;
  sent: FileEditorMessage[] = [];
  constructor() {
    FixtureSocket.instances.push(this);
  }
  send(source: string) {
    this.sent.push(JSON.parse(source));
  }
  receive(message: FileEditorServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FixtureSocket.instances.length = 0;
});
function setup() {
  vi.stubGlobal('WebSocket', FixtureSocket);
  vi.stubGlobal('location', { href: 'http://localhost' });
  const changed = vi.fn();
  const connection = createEditorConnection('a', changed);
  return { connection, socket: FixtureSocket.instances[0]!, changed };
}

it('登记前不可编辑；预留立即锁定并报告最后一次编辑，解锁后保留缓冲', () => {
  const { connection, socket } = setup();
  expect(connection.canEdit()).toBe(false);
  socket.receive({ type: 'ready' });
  expect(connection.canEdit()).toBe(true);
  connection.update({ path: 'code.py', dirty: true, busy: false });
  const token = crypto.randomUUID();
  socket.receive({ type: 'reserve', token });
  expect(connection.canEdit()).toBe(false);
  expect(socket.sent.at(-1)).toMatchObject({ type: 'reserved', token, state: { dirty: true } });
  socket.receive({ type: 'unlock', token });
  expect(connection.canEdit()).toBe(true);
  connection.dispose();
  expect(socket.sent.some((message) => message.type === 'release')).toBe(false);
});

it('失联时禁写，明确放弃关闭才发送释放登记', () => {
  vi.useFakeTimers();
  const { connection, socket } = setup();
  socket.receive({ type: 'ready' });
  connection.update({ path: 'code.py', dirty: true, busy: false });
  socket.close();
  expect(connection.canEdit()).toBe(false);
  vi.advanceTimersByTime(1500);
  const reconnected = FixtureSocket.instances[1]!;
  reconnected.receive({ type: 'ready' });
  expect(reconnected.sent.at(-1)).toMatchObject({ type: 'state', state: { path: 'code.py', dirty: true } });
  connection.approveClose();
  connection.dispose();
  expect(reconnected.sent.at(-1)).toEqual({ type: 'release' });
});
