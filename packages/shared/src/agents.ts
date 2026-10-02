import { z } from 'zod';
import type { AgentEvent } from './events';

export const AgentKindSchema = z.enum(['claude', 'codex']);
export const NativeSessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export type AgentKind = z.infer<typeof AgentKindSchema>;
/** Codex 的 sessionId 对应 thread.id，不能使用分叉树根的 thread.sessionId。 */
export type SessionRef = { agent: AgentKind; sessionId: string };
export type SessionSummary = SessionRef & { summary: string; lastModified: number };
export type SessionHistory = { session: SessionSummary; events: AgentEvent[]; actualModel?: string };
