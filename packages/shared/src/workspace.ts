import { z } from 'zod';
import { SyncSettingsSchema } from './sync';

// 服务器目录：以 / 或 ~ 开头，不能含换行和 NUL（会破坏远程命令拼装）
const remoteDirSchema = z
  .string()
  .regex(/^[/~]/, '服务器目录必须以 / 或 ~ 开头')
  .refine((s) => !/[\r\n\0]/.test(s), '服务器目录不能包含换行或 NUL 字符');

export const SshAuthModeSchema = z.enum(['key', 'password']);
export type SshAuthMode = z.infer<typeof SshAuthModeSchema>;

export const WorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  /** 本地文件夹的绝对路径，是否存在由后端检查 */
  localDir: z.string().min(1),
  /** ~/.ssh/config 中的 Host 别名 */
  sshHost: z.string().min(1),
  /** 不传时复用已有私钥；密码只通过独立认证接口提交 */
  authMode: SshAuthModeSchema.optional(),
  remoteDir: remoteDirSchema,
  sync: SyncSettingsSchema.optional(),
  policy: z
    .object({
      /** 按 ruleId 停用的默认黑名单规则 */
      disabledRules: z.array(z.string()).optional(),
    })
    .optional(),
});

export type WorkspaceInput = z.infer<typeof WorkspaceInputSchema>;
export type Workspace = WorkspaceInput & { id: string };

/** ~/.ssh/config 中可选的 Host，unsupported 列出本工具暂不支持的选项（如 ProxyJump） */
export type SshHostInfo = {
  alias: string;
  hostname?: string;
  user?: string;
  port?: number;
  unsupported: string[];
};
