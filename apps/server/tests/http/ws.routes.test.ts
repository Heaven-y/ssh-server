import { once } from 'node:events';
import { expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../../src/http/app';
import { registerWsRoutes } from '../../src/http/ws.routes';
import { TurnManager } from '../../src/chat/turn-manager';
import { SESSION_COOKIE } from '../../src/http/security';

it('发送参数错误按clientTurnId回传，客户端可结束等待且不泄漏输入', async () => {
  const token = 'test-ws-dialogue-token';
  const turns = new TurnManager({
    getWorkspace: async () => undefined,
    runners: {},
    sessions: { assertBelongs: async () => undefined },
  });
  const app = await buildApp({ token, port: 0, routes: (server) => registerWsRoutes(server, { turns }) });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('缺少监听地址');
  const origin = `http://127.0.0.1:${address.port}`;
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
    origin,
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  try {
    await once(ws, 'open');
    const response = once(ws, 'message');
    ws.send(
      JSON.stringify({ type: 'chat.send', clientTurnId: 'client-request', text: 2, private: 'synthetic-secret' }),
    );
    const [data] = await response;
    expect(JSON.parse(String(data))).toEqual({
      type: 'error',
      clientTurnId: 'client-request',
      message: '消息格式不正确',
    });
  } finally {
    ws.terminate();
    await turns.dispose();
    await app.close();
  }
});
