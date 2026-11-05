import { z } from 'zod';

export const AgentKindSchema = z.enum(['claude', 'codex', 'antigravity']);
export const NativeSessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
/** 只接收原生轮次/消息 ID，不接收文件路径或其他原生参数覆盖。 */
export const SessionForkSchema = z.object({ pointId: NativeSessionIdSchema.optional() }).strict();
export type SessionForkInput = z.infer<typeof SessionForkSchema>;
export const SessionActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rename'), title: z.string().trim().min(1).max(200) }).strict(),
  z.object({ action: z.literal('delete'), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('archive') }).strict(),
  z.object({ action: z.literal('unarchive') }).strict(),
]);
export type SessionActionInput = z.infer<typeof SessionActionSchema>;
export type AgentKind = z.infer<typeof AgentKindSchema>;
