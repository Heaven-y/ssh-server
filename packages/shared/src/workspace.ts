import { z } from 'zod';

// 服务器目录：以 / 或 ~ 开头，不能含换行和 NUL（会破坏远程命令拼装）
const remoteDirSchema = z
  .string()
  .regex(/^[/~]/, '服务器目录必须以 / 或 ~ 开头')
  .refine((s) => !/[\r\n\0]/.test(s), '服务器目录不能包含换行或 NUL 字符');

export const WorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  /** 本地文件夹的绝对路径，是否存在由后端检查 */
  localDir: z.string().min(1),
  /** ~/.ssh/config 中的 Host 别名 */
  sshHost: z.string().min(1),
  remoteDir: remoteDirSchema,
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
