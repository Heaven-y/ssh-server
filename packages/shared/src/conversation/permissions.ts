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

/** 工作台会话权限覆盖；null 表示移除工作台记录并恢复原生默认。 */
export const SessionPermissionInputSchema = z.strictObject({
  permission: PermissionSelectionSchema.nullable(),
});
export type SessionPermissionDocument = z.infer<typeof SessionPermissionInputSchema>;
