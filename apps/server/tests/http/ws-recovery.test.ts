import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { AgentTurnInput } from '../../src/agents/contracts';
import { TurnManager } from '../../src/chat/turn-manager';
import { buildApp } from '../../src/http/app';
import { registerWsRoutes } from '../../src/http/ws.routes';
import { SESSION_COOKIE } from '../../src/http/security';

type Wire = { type: string; sequence?: number; code?: string; message?: Wire; turnId?: string; turns?: unknown[] };
const send = (clientTurnId: string) => ({
  type: 'chat.send',
  workspaceId: 'demo',
  agent: 'claude',
  text: '合成消息',
  clientTurnId,
});

async function setup() {
  const runs: Array<{ input: AgentTurnInput; finish(): void; interrupted: boolean }> = [];
  const turns = new TurnManager({
    getWorkspace: async () => ({ id: 'demo', name: 'demo', dir: process.cwd() }),
    sessions: { assertBelongs: async () => undefined },
    runners: {
      claude: (input) => {
        let finish!: () => void;
        const done = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const run = { input, finish, interrupted: false };
        runs.push(run);
        return {
          done,
          interrupt: async () => {
            run.interrupted = true;
            finish();
          },
        };
      },
    },
  });
  const auth = randomUUID();
  const app = await buildApp({ token: auth, port: 0, routes: (server) => registerWsRoutes(server, { turns }) });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('缺少监听地址');
  const port = address.port;
  const clients: WebSocket[] = [];
  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: `http://127.0.0.1:${port}`,
      headers: { cookie: `${SESSION_COOKIE}=${auth}` },
    });
    const received: Wire[] = [];
    ws.on('message', (data) => received.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Wire));
    clients.push(ws);
    await once(ws, 'open');
    return { ws, received, send: (message: unknown) => ws.send(JSON.stringify(message)) };
  }
  return {
    runs,
    turns,
    connect,
    close: async () => {
      clients.forEach((ws) => ws.terminate());
      await turns.dispose();
      await app.close();
    },
  };
}

it('短断线保留并行回合和审批，重连只补游标之后的事件且拒绝迟到旧连接操作', async () => {
  const f = await setup();
  try {
    const token = randomUUID();
    const a = await f.connect();
    a.send({ type: 'connection.resume', token, create: true, rebuild: true, afterSequence: 0 });
    await vi.waitFor(() => expect(a.received.at(-1)?.type).toBe('connection.ready'));
    a.send(send('first'));
    a.send(send('second'));
    await vi.waitFor(() => expect(f.runs).toHaveLength(2));
    const permission = f.runs[0]!.input.requestPermission({ requestId: 'approval', toolName: 'command', input: {} });
    f.runs[0]!.input.emit({ type: 'permission_request', requestId: 'approval', toolName: 'command', input: {} });
    await vi.waitFor(() => expect(a.received.filter((m) => m.type === 'connection.event')).toHaveLength(3));
    const cursor = a.received.at(-1)!.sequence;
    const turnId = a.received.find((m) => m.message?.type === 'turn.started')!.message!.turnId;
    a.ws.close();
    await once(a.ws, 'close');
    f.runs[0]!.input.emit({ type: 'text', delta: '离线输出' });
    expect(f.runs.some((r) => r.interrupted)).toBe(false);
    const b = await f.connect();
    b.send({ type: 'connection.resume', token, create: false, rebuild: false, afterSequence: cursor });
    await vi.waitFor(() => expect(b.received.at(-1)?.type).toBe('connection.ready'));
    expect(b.received.filter((m) => m.type === 'connection.event')).toMatchObject([
      { sequence: cursor! + 1, message: { type: 'agent.event', event: { type: 'text', delta: '离线输出' } } },
    ]);
    b.send({ type: 'permission.respond', turnId, requestId: 'approval', allow: true });
    expect(await permission).toMatchObject({ allow: true });
    b.send(send('first'));
    b.send({ type: 'chat.interrupt', turnId });
    await vi.waitFor(() => expect(f.runs[0]!.interrupted).toBe(true));
    expect(f.runs).toHaveLength(2);
    expect(f.runs[1]!.interrupted).toBe(false);
  } finally {
    await f.close();
  }
});

it('刷新从后端重建全部保留回合，另一页签不能并发接管，未知身份明确失败', async () => {
  const f = await setup();
  try {
    const token = randomUUID();
    const a = await f.connect();
    a.send({ type: 'connection.resume', token, create: true, rebuild: true, afterSequence: 0 });
    await vi.waitFor(() => expect(a.received.at(-1)?.type).toBe('connection.ready'));
    a.send(send('first'));
    a.send(send('background'));
    await vi.waitFor(() => expect(f.runs).toHaveLength(2));
    const other = await f.connect();
    other.send({ type: 'connection.resume', token, create: false, rebuild: true, afterSequence: 0 });
    await vi.waitFor(() =>
      expect(other.received.at(-1)).toMatchObject({ type: 'connection.rejected', code: 'owner_connected' }),
    );
    expect(other.received).toHaveLength(1);
    a.ws.close();
    await once(a.ws, 'close');
    f.runs[1]!.input.emit({ type: 'text', delta: '后台回复' });
    const refreshed = await f.connect();
    refreshed.send({ type: 'connection.resume', token, create: false, rebuild: true, afterSequence: 0 });
    await vi.waitFor(() => expect(refreshed.received.at(-1)?.type).toBe('connection.ready'));
    expect(refreshed.received[0]).toMatchObject({
      type: 'connection.snapshot',
      turns: [
        { message: { clientTurnId: 'first', text: '合成消息' } },
        { message: { clientTurnId: 'background', text: '合成消息' } },
      ],
    });
    expect(refreshed.received.filter((m) => m.type === 'connection.event')).toHaveLength(3);
    const unknown = await f.connect();
    unknown.send({ type: 'connection.resume', token: randomUUID(), create: false, rebuild: true, afterSequence: 0 });
    await vi.waitFor(() =>
      expect(unknown.received.at(-1)).toMatchObject({ type: 'connection.rejected', code: 'owner_missing' }),
    );
    expect(f.runs.some((r) => r.interrupted)).toBe(false);
  } finally {
    await f.close();
  }
});
