import { z } from 'zod';

// 服务器目录：以 / 或 ~ 开头，不能含换行和 NUL（会破坏远程命令拼装）
const remoteDirSchema = z
  .string()
  .regex(/^[/~]/, '服务器目录必须以 / 或 ~ 开头')
  .refine((s) => !/[\r\n\0]/.test(s), '服务器目录不能包含换行或 NUL 字符');

export const SshAuthModeSchema = z.enum(['key', 'password']);
export type SshAuthMode = z.infer<typeof SshAuthModeSchema>;

/**
 * 项目输入：名称 + 本地项目目录，可选绑定一台服务器。
 * 旧的 localDir / sshHost / sync / policy 不再声明；zod 默认丢弃未知键，
 * 因此旧配置能被读入而不会整份解析失败（字段级迁移见后续任务）。
 */
export const WorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  /** 本地项目目录的绝对路径，是否存在由后端检查 */
  dir: z.string().min(1),
  /** 服务器档案中的稳定别名；不绑定服务器时省略 */
  server: z.string().min(1).optional(),
  /** 服务器面板的默认浏览目录；不绑定服务器时省略 */
  remoteDir: remoteDirSchema.optional(),
});

export const WorkspaceSchema = WorkspaceInputSchema.extend({ id: z.string().min(1) });
export type WorkspaceInput = z.infer<typeof WorkspaceInputSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;

/** 已绑定服务器与默认目录的项目；只有这类项目能打开服务器面板。 */
export type BoundWorkspace = Workspace & { server: string; remoteDir: string };
export const isBoundWorkspace = (workspace: Workspace): workspace is BoundWorkspace =>
  Boolean(workspace.server && workspace.remoteDir);

/** ~/.ssh/config 中可选的 Host，unsupported 列出本工具暂不支持的选项（如 ProxyJump） */
export type SshHostInfo = {
  alias: string;
  name?: string;
  source?: 'ssh-config' | 'manual';
  hostname?: string;
  user?: string;
  port?: number;
  unsupported: string[];
};
