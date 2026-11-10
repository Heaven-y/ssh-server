// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectChat } from '../../src/lib/ws';

const sockets = vi.hoisted(
  () => [] as Array<{ emit(type: string, data?: unknown): void; sent: unknown[]; readyState: number }>,
);
vi.mock('partysocket', () => ({
  WebSocket: class {
    OPEN = 1;
    readyState = 0;
    shouldReconnect = true;
    sent: unknown[] = [];
    listeners = new Map<string, Array<(event: unknown) => void>>();
    constructor() {
      sockets.push(this);
    }
    addEventListener(type: string, listener: (event: unknown) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    emit(type: string, data?: unknown) {
      if (type === 'open') this.readyState = 1;
      if (type === 'close') this.readyState = 0;
      for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) });
    }
    send(value: string) {
      this.sent.push(JSON.parse(value));
    }
    reconnect() {
      this.emit('close');
    }
    close() {
      this.shouldReconnect = false;
      this.emit('close');
    }
  },
}));
beforeEach(() => {
  sockets.length = 0;
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const request = {
  type: 'chat.send' as const,
  workspaceId: 'demo',
  agent: 'claude' as const,
  text: '合成正文',
  clientTurnId: 'synthetic',
};

it('连接握手完成前禁发，精确忽略重复事件，重连带内存游标且从不补发用户消息', async () => {
  const messages: unknown[] = [];
  const statuses: string[] = [];
  const connection = connectChat({ onMessage: (m) => messages.push(m), onStatus: (s) => statuses.push(s) });
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  const ws = sockets[0]!;
  ws.emit('open');
  expect(connection.send(request)).toBe(false);
  expect(ws.sent[0]).toMatchObject({ type: 'connection.resume', create: true, rebuild: true, afterSequence: 0 });
  ws.emit('message', { type: 'connection.snapshot', turns: [] });
  ws.emit('message', { type: 'connection.ready', sequence: 0, acceptedClientTurnIds: [] });
  expect(connection.send(request)).toBe(true);
  const event = {
    type: 'connection.event',
    sequence: 1,
    message: { type: 'agent.event', turnId: 'turn', event: { type: 'text', delta: '合成正文' } },
  };
  ws.emit('message', event);
  ws.emit('message', event);
  expect(messages).toHaveLength(1);
  ws.emit('close');
  ws.emit('open');
  expect(ws.sent.at(-1)).toMatchObject({ type: 'connection.resume', create: false, rebuild: false, afterSequence: 1 });
  expect(ws.sent.filter((m) => (m as { type: string }).type === 'chat.send')).toHaveLength(1);
  expect(statuses.at(-1)).toBe('connecting');
  const stored = Array.from({ length: sessionStorage.length }, (_, i) =>
    sessionStorage.getItem(sessionStorage.key(i)!),
  );
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatch(/^[0-9a-f-]{36}$/);
  connection.close();
});

it('刷新复用随机身份但从零重建，事件缺口不继续接收，后端重启拒绝后不会自动重发', async () => {
  const token = crypto.randomUUID();
  sessionStorage.setItem('agentdeck.chatRecovery', token);
  const notices: unknown[] = [];
  const messages: unknown[] = [];
  const connection = connectChat({
    onMessage: (m) => messages.push(m),
    onStatus: () => undefined,
    onRecovery: (m) => notices.push(m),
  });
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  const ws = sockets[0]!;
  ws.emit('open');
  expect(ws.sent[0]).toMatchObject({ token, create: false, rebuild: true, afterSequence: 0 });
  ws.emit('message', { type: 'connection.rejected', code: 'owner_missing', message: '恢复已失效' });
  expect(notices.at(-1)).toMatchObject({ code: 'owner_missing' });
  expect(messages).toEqual([]);
  await vi.waitFor(() => expect(ws.readyState).toBe(0));
  ws.emit('open');
  expect(ws.sent.at(-1)).toMatchObject({ create: true, rebuild: true, afterSequence: 0 });
  expect(ws.sent.at(-1)).not.toMatchObject({ token });
  ws.emit('message', { type: 'connection.snapshot', turns: [] });
  ws.emit('message', { type: 'connection.ready', sequence: 0, acceptedClientTurnIds: [] });
  ws.emit('message', { type: 'connection.event', sequence: 2, message: { type: 'error', message: '乱序' } });
  expect(messages).toEqual([]);
  expect(connection.send(request)).toBe(false);
  connection.close();
});

it('复制页签继承了sessionStorage时仍不能接管离线原页签，关闭页面后释放身份', async () => {
  const held = new Set<string>();
  vi.stubGlobal('navigator', {
    locks: {
      request: async (name: string, _options: unknown, callback: (lock: object | null) => Promise<void> | void) => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          await callback({ name });
        } finally {
          held.delete(name);
        }
      },
    },
  });
  const first = connectChat({ onMessage: () => undefined, onStatus: () => undefined });
  await vi.waitFor(() => expect(held.size).toBe(1));
  const original = sessionStorage.getItem('agentdeck.chatRecovery');
  sockets[0]!.emit('open');
  sockets[0]!.emit('message', { type: 'connection.snapshot', turns: [] });
  sockets[0]!.emit('message', { type: 'connection.ready', sequence: 0, acceptedClientTurnIds: [] });
  sockets[0]!.emit('close');
  const cloned = connectChat({ onMessage: () => undefined, onStatus: () => undefined });
  await vi.waitFor(() => expect(held.size).toBe(2));
  sockets[1]!.emit('open');
  expect(sockets[1]!.sent.at(-1)).not.toMatchObject({ token: original });
  expect(sockets[1]!.sent.at(-1)).toMatchObject({ create: true });
  first.close();
  cloned.close();
  await vi.waitFor(() => expect(held.size).toBe(0));
});

it('刷新时旧连接迟到关闭先重试原恢复身份，不立即遗弃仍在运行的回合', async () => {
  vi.useFakeTimers();
  const token = crypto.randomUUID();
  sessionStorage.setItem('agentdeck.chatRecovery', token);
  const notices: unknown[] = [];
  const connection = connectChat({
    onMessage: () => undefined,
    onStatus: () => undefined,
    onRecovery: (notice) => notices.push(notice),
  });
  await vi.advanceTimersByTimeAsync(0);
  const ws = sockets[0]!;
  ws.emit('open');
  ws.emit('message', { type: 'connection.rejected', code: 'owner_connected', message: '旧连接尚在关闭' });
  await vi.advanceTimersByTimeAsync(1200);
  ws.emit('open');
  expect(ws.sent.at(-1)).toMatchObject({ token, create: false, rebuild: true });
  expect(notices).toEqual([]);
  ws.emit('message', { type: 'connection.snapshot', turns: [] });
  ws.emit('message', { type: 'connection.ready', sequence: 0, acceptedClientTurnIds: [] });
  expect(connection.send(request)).toBe(true);
  connection.close();
});

it('恢复容量不足时停止自动重连，用户显式重试才重新建立连接', async () => {
  vi.useFakeTimers();
  const notices: unknown[] = [];
  const connection = connectChat({
    onMessage: () => undefined,
    onStatus: () => undefined,
    onRecovery: (notice) => notices.push(notice),
  });
  await vi.advanceTimersByTimeAsync(0);
  const ws = sockets[0]!;
  ws.emit('open');
  const token = sessionStorage.getItem('agentdeck.chatRecovery');
  ws.emit('message', { type: 'connection.rejected', code: 'capacity', message: '容量已满' });
  await vi.advanceTimersByTimeAsync(100_000);
  expect(notices).toHaveLength(1);
  expect(sessionStorage.getItem('agentdeck.chatRecovery')).toBe(token);
  expect(connection.send(request)).toBe(false);
  connection.reconnect();
  await vi.advanceTimersByTimeAsync(0);
  ws.emit('open');
  expect(ws.sent.at(-1)).toMatchObject({ create: true });
  connection.close();
});

it('长期离线有明确失败，重复断开不延长期限，关闭连接后不再回调恢复失败', async () => {
  vi.useFakeTimers();
  const notices: unknown[] = [];
  const connection = connectChat({
    onMessage: () => undefined,
    onStatus: () => undefined,
    onRecovery: (notice) => notices.push(notice),
  });
  await vi.advanceTimersByTimeAsync(0);
  const ws = sockets[0]!;
  ws.emit('open');
  ws.emit('message', { type: 'connection.snapshot', turns: [] });
  ws.emit('message', { type: 'connection.ready', sequence: 0, acceptedClientTurnIds: [] });
  ws.emit('close');
  await vi.advanceTimersByTimeAsync(50_000);
  ws.emit('close');
  await vi.advanceTimersByTimeAsync(45_000);
  expect(notices.at(-1)).toMatchObject({ type: 'connection.rejected', code: 'owner_missing' });
  expect(connection.send(request)).toBe(false);
  connection.close();
  const count = notices.length;
  ws.emit('close');
  await vi.advanceTimersByTimeAsync(100_000);
  expect(notices).toHaveLength(count);
});
