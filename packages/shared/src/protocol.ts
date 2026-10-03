import { z } from 'zod';
import { AgentKindSchema, NativeSessionIdSchema, type AgentKind } from './agents';
import { CapabilitySelectionSchema } from './capabilities';
import type { AgentEvent } from './events';

// 前端 → 后端的 WebSocket 消息，后端用 schema 校验
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('chat.send'),
      workspaceId: z.string().min(1),
      /** 旧调用未指定时，后端使用 Claude。 */
      agent: AgentKindSchema.optional(),
      /** 继续已有会话时传入 */
      sessionId: NativeSessionIdSchema.optional(),
      text: z.string(),
      selection: CapabilitySelectionSchema.optional(),
      /** 不传表示跟随本地配置 */
      model: z.string().min(1).optional(),
      /** Codex 原生推理强度；未指定时沿用本机配置。 */
      reasoningEffort: z.string().min(1).max(40).optional(),
      /** 前端生成，用于把 turn.started 与本次发送对应起来 */
      clientTurnId: z.string().min(1),
    })
    .refine((message) => message.text.trim().length > 0 || !!message.selection, {
      message: '请输入消息或选择技能与命令',
    }),
  z.object({
    type: z.literal('chat.interrupt'),
    turnId: z.string().min(1),
  }),
  z.object({
    type: z.literal('permission.respond'),
    turnId: z.string().min(1),
    requestId: z.string().min(1),
    allow: z.boolean(),
    message: z.string().optional(),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// 后端 → 前端的 WebSocket 消息
export type ServerMessage =
  | { type: 'turn.started'; turnId: string; clientTurnId: string; workspaceId: string; agent: AgentKind }
  | { type: 'agent.event'; turnId: string; event: AgentEvent }
  | { type: 'turn.finished'; turnId: string; workspaceId: string; agent: AgentKind }
  | { type: 'error'; turnId?: string; clientTurnId?: string; message: string };
