import { z } from 'zod';

/** 省略表示沿用原生配置；各 CLI 的模式不互相转换。 */
export const PermissionSelectionSchema = z.discriminatedUnion('agent', [
  z.strictObject({
    agent: z.literal('claude'),
    mode: z.enum(['default', 'acceptEdits', 'auto', 'plan', 'dontAsk', 'bypassPermissions']),
  }),
  z.strictObject({ agent: z.literal('codex'), mode: z.enum(['native', 'ask', 'auto-review', 'full-access']) }),
  z.strictObject({ agent: z.literal('antigravity'), mode: z.enum(['accept-edits', 'auto', 'plan', 'bypass']) }),
]);
export type PermissionSelection = z.infer<typeof PermissionSelectionSchema>;
