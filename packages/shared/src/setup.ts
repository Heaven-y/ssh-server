import { z } from 'zod';

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]+$/u);
export const ManualServerInputSchema = z
  .object({
    name: text(100),
    hostname: text(255)
      .transform((value) => value.replace(/^\[(.*)\]$/, '$1').toLowerCase())
      .refine((value) => /^[a-z0-9._:-]+$/i.test(value) && !value.startsWith('-'), '服务器地址格式不合法'),
    port: z.number().int().min(1).max(65535).default(22),
    username: text(128).refine((value) => !/\s/.test(value), '账号不能包含空白字符'),
    keyFile: text(4096).optional(),
  })
  .strict();
export type ManualServerInput = z.infer<typeof ManualServerInputSchema>;
export type ManagedServer = ManualServerInput & { alias: string };
export const ManagedServerSchema = ManualServerInputSchema.extend({
  alias: z.string().regex(/^managed-ssh-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/),
});
