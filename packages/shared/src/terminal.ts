import { z } from 'zod';
import type { Workspace } from './workspace';

/** 终端专用限制；正文不进入聊天协议或持久存储。 */
export const TERMINAL_LIMITS = {
  bindingMs: 300_000,
  frameBytes: 32_768,
  controlBytes: 65_536,
  inputBytes: 262_144,
  initBytes: 131_072,
  outputBytes: 1_048_576,
  outputPauseBytes: 262_144,
  resumeBytes: 65_536,
  startupMs: 30_000,
  initMs: 10_000,
  pingMs: 20_000,
  inactivityMs: 60_000,
  workspaceSessions: 8,
  totalSessions: 32,
  panes: 4,
  scrollback: 2_000,
} as const;

export const TerminalTargetSchema = z.strictObject({
  workspaceId: z.string().min(1).max(200),
  sshHost: z.string().min(1).max(4096),
  remoteDir: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[/~]/)
    .refine((value) => !/[\r\n\0]/.test(value)),
});
export const TerminalSizeSchema = z.strictObject({
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(500),
});
export const TerminalTokenSchema = z.string().regex(/^1\.[0-9]{1,16}\.[a-f0-9]{32}\.[a-f0-9]{64}$/);
export const TerminalBindingRequestSchema = z.strictObject({
  target: TerminalTargetSchema,
  previousBinding: TerminalTokenSchema.optional(),
});
export const TerminalBindingSchema = z.strictObject({
  binding: TerminalTokenSchema,
  expiresAt: z.number().int().positive(),
  target: TerminalTargetSchema,
});

/** 校验 padding 的未使用位，避免同一字节对应多个编码。 */
const InputDataSchema = z
  .string()
  .min(4)
  .max(Math.ceil(TERMINAL_LIMITS.frameBytes / 3) * 4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/)
  .refine(
    (value) =>
      (value.length / 4) * 3 - (value.endsWith('==') ? 2 : Number(value.endsWith('='))) <= TERMINAL_LIMITS.frameBytes,
  );
export const TerminalClientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('open'),
    target: TerminalTargetSchema,
    binding: TerminalTokenSchema,
    size: TerminalSizeSchema,
  }),
  z.strictObject({ type: z.literal('input'), data: InputDataSchema }),
  z.strictObject({ type: z.literal('resize'), size: TerminalSizeSchema }),
  z.strictObject({ type: z.literal('ack'), bytes: z.number().int().positive().max(TERMINAL_LIMITS.outputBytes) }),
  z.strictObject({ type: z.literal('close') }),
]);
export const TerminalServerMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('ready'),
    sessionId: z.string().uuid(),
    target: TerminalTargetSchema,
    startDir: z.string().min(1).max(4096),
  }),
  z.strictObject({ type: z.literal('input-flow'), paused: z.boolean() }),
  z.strictObject({
    type: z.literal('exit'),
    exitCode: z.number().int().nullable(),
    signal: z.string().max(100).nullable(),
    outputComplete: z.boolean(),
  }),
  z.strictObject({ type: z.literal('error'), code: z.string().min(1).max(100), message: z.string().min(1).max(500) }),
]);
export type TerminalTarget = z.infer<typeof TerminalTargetSchema>;
export type TerminalSize = z.infer<typeof TerminalSizeSchema>;
export type TerminalBinding = z.infer<typeof TerminalBindingSchema>;
export type TerminalClientMessage = z.infer<typeof TerminalClientMessageSchema>;
export type TerminalServerMessage = z.infer<typeof TerminalServerMessageSchema>;
export const workspaceTerminalTarget = (workspace: Workspace): TerminalTarget => ({
  workspaceId: workspace.id,
  sshHost: workspace.sshHost,
  remoteDir: workspace.remoteDir,
});
export const terminalTargetKey = (target: TerminalTarget): string =>
  JSON.stringify([target.workspaceId, target.sshHost, target.remoteDir]);
