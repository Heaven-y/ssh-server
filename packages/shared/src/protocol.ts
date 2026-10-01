import { z } from 'zod';
import type { AgentEvent } from './events';

// 前端 → 后端的 WebSocket 消息，后端用 schema 校验
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat.send'),
    workspaceId: z.string().min(1),
    /** 继续已有会话时传入 */
    sessionId: z.string().min(1).optional(),
    text: z.string().min(1),
    /** 不传表示跟随本地配置 */
    model: z.string().min(1).optional(),
    /** 前端生成，用于把 turn.started 与本次发送对应起来 */
    clientTurnId: z.string().min(1),
  }),
  z.object({
    type: z.literal('chat.interrupt'),
    turnId: z.string().min(1),
  }),
  z.object({
    type: z.literal('permission.respond'),
    requestId: z.string().min(1),
    allow: z.boolean(),
    message: z.string().optional(),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// 后端 → 前端的 WebSocket 消息
export type ServerMessage =
  | { type: 'turn.started'; turnId: string; clientTurnId: string }
  | { type: 'agent.event'; turnId: string; event: AgentEvent }
  | { type: 'turn.finished'; turnId: string }
  | { type: 'error'; turnId?: string; message: string };
