// 对话 WebSocket：/ws（访问控制在 security.ts 的 onRequest 钩子里完成）
import type { FastifyInstance } from 'fastify';
import { ClientMessageSchema, ResumeRequestSchema } from '@agentdeck/shared/conversation';
import { z } from 'zod';
import type { Socket, TurnManager } from '../chat/turn-manager';
import { ResumeHub } from '../chat/resume-hub';

const WS_OPEN = 1;
const SendingIdentity = z.object({ type: z.literal('chat.send'), clientTurnId: z.string().min(1).max(200) });

function sendingIdentity(value: unknown): { clientTurnId?: string } {
  const parsed = SendingIdentity.safeParse(value);
  return parsed.success ? { clientTurnId: parsed.data.clientTurnId } : {};
}

/** ws 的消息可能是 Buffer、ArrayBuffer 或分片数组 */
function rawText(data: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data as ArrayBuffer).toString('utf8');
}

export function registerWsRoutes(app: FastifyInstance, deps: { turns: TurnManager }): void {
  const recovery = new ResumeHub(deps.turns);
  app.addHook('onClose', (_server, done) => {
    recovery.dispose();
    done();
  });
  app.get('/ws', { websocket: true }, (ws) => {
    const peer = {
      send: (data: string) => ws.send(data),
      isOpen: () => ws.readyState === WS_OPEN,
      close: () => ws.terminate(),
    };
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      if (peer.isOpen()) ws.ping();
    }, 15_000);
    heartbeat.unref();
    let socket: Socket = {
      send: (msg) => ws.send(JSON.stringify(msg)),
      isOpen: () => ws.readyState === WS_OPEN,
    };
    let mode: 'initial' | 'legacy' | 'recovery' | 'rejected' = 'initial';

    ws.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText(data));
      } catch {
        socket.send({ type: 'error', message: '消息不是合法的 JSON' });
        return;
      }
      if (mode === 'rejected') return;
      const resume = ResumeRequestSchema.safeParse(parsed);
      if (mode === 'initial' && resume.success) {
        const attached = recovery.attach(peer, resume.data);
        mode = attached ? 'recovery' : 'rejected';
        if (attached) socket = attached;
        return;
      }
      if (mode === 'initial') mode = 'legacy';
      const msg = ClientMessageSchema.safeParse(parsed);
      if (!msg.success) {
        socket.send({ type: 'error', ...sendingIdentity(parsed), message: '消息格式不正确' });
        return;
      }
      const handled =
        mode === 'recovery' ? recovery.handle(peer, socket, msg.data) : deps.turns.handle(socket, msg.data);
      handled.catch(() => {
        if (socket.isOpen())
          socket.send({
            type: 'error',
            ...sendingIdentity(msg.data),
            message: '会话操作失败，请检查原生运行状态后重试',
          });
      });
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      if (mode === 'recovery') recovery.detach(peer, socket);
      else deps.turns.socketClosed(socket);
    });
  });
}
