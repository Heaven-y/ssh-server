import { z } from 'zod';
export const SshAuthModeSchema = z.enum(['key', 'password']);
export type SshAuthMode = z.infer<typeof SshAuthModeSchema>;

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
