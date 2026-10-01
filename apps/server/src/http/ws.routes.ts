// 对话 WebSocket：/ws（访问控制在 security.ts 的 onRequest 钩子里完成）
import type { FastifyInstance } from 'fastify';
import { ClientMessageSchema } from '@ssh-server/shared';
import type { Socket, TurnManager } from '../chat/turn-manager';

const WS_OPEN = 1;

/** ws 的消息可能是 Buffer、ArrayBuffer 或分片数组 */
function rawText(data: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data as ArrayBuffer).toString('utf8');
}

export function registerWsRoutes(app: FastifyInstance, deps: { turns: TurnManager }): void {
  app.get('/ws', { websocket: true }, (ws) => {
    const socket: Socket = {
      send: (msg) => ws.send(JSON.stringify(msg)),
      isOpen: () => ws.readyState === WS_OPEN,
    };

    ws.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText(data));
      } catch {
        socket.send({ type: 'error', message: '消息不是合法的 JSON' });
        return;
      }
      const msg = ClientMessageSchema.safeParse(parsed);
      if (!msg.success) {
        socket.send({ type: 'error', message: '消息格式不正确' });
        return;
      }
      deps.turns.handle(socket, msg.data).catch((e: unknown) => {
        if (socket.isOpen()) socket.send({ type: 'error', message: (e as Error).message });
      });
    });

    ws.on('close', () => deps.turns.socketClosed(socket));
  });
}
