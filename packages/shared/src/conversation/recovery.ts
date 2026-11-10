import { z } from 'zod';
import type { ClientMessage, ServerMessage } from './protocol';

/** 只有首帧可以启用恢复；身份是页签专属随机凭据，不包含会话正文。 */
export const ResumeRequestSchema = z.object({
  type: z.literal('connection.resume'),
  token: z.uuid(),
  /** 同一文档重连时保持不变；刷新后重新生成，不能用于跨页签接管。 */
  instanceId: z.uuid().optional(),
  create: z.boolean(),
  rebuild: z.boolean(),
  afterSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type ResumeRequest = z.infer<typeof ResumeRequestSchema>;
export type RecoveryTurn = { message: Extract<ClientMessage, { type: 'chat.send' }>; sentAt: number };
export type RecoveryFailureCode = 'owner_missing' | 'owner_connected' | 'cache_expired' | 'capacity' | 'server_closed';
export type RecoveryNotice =
  | { type: 'connection.snapshot'; turns: RecoveryTurn[] }
  | { type: 'connection.ready'; sequence: number; acceptedClientTurnIds: string[] }
  | { type: 'connection.rejected'; code: RecoveryFailureCode; message: string };
export type RecoveryServerMessage =
  RecoveryNotice | { type: 'connection.event'; sequence: number; message: ServerMessage };
