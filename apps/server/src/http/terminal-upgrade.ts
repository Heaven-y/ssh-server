import { WebSocketServer } from 'ws';
import type { FastifyInstance } from 'fastify';
import { TERMINAL_LIMITS } from '@ssh-server/shared';

/** 沿用 Fastify 的升级/安全钩子，只在公开 handleUpgrade 入口选择终端帧限制。 */
export function registerTerminalUpgrade(app: FastifyInstance): void {
  const server = new WebSocketServer({ noServer: true, maxPayload: TERMINAL_LIMITS.controlBytes });
  const original = app.websocketServer.handleUpgrade.bind(app.websocketServer);
  app.websocketServer.handleUpgrade = (request, socket, head, done) => {
    const path = (request.url ?? '').split('?', 1)[0]!;
    if (/^\/api\/workspaces\/[^/]+\/terminal$/.test(path)) server.handleUpgrade(request, socket, head, done);
    else original(request, socket, head, done);
  };
  app.addHook('onClose', (_instance, done) => {
    for (const socket of server.clients) socket.terminate();
    server.close(() => done());
  });
}
