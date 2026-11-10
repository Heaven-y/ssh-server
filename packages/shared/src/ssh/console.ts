import { z } from 'zod';
import type { ResourceHost, ResourceReading } from './resources';
import { TerminalSizeSchema } from './terminal';

/** 独立 SSH 控制台只用服务器档案 alias 定位，不附带项目身份。 */
export const SSH_CONSOLE_LIMITS = {
  refreshMs: 2000,
  metricsTimeoutMs: 25000,
  directoryEntries: 400,
  previewBytes: 256 * 1024,
  terminalBytes: 512 * 1024,
  terminalReadBytes: 64 * 1024,
  terminalsPerServer: 6,
  terminalsTotal: 32,
  processRows: 100,
  gpuProcessRows: 512,
} as const;

export const SshConsoleServerIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\r\n\0]+$/);
export const SshConsolePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\r\n\0]+$/);
export const SshConsoleTerminalCreateSchema = TerminalSizeSchema.extend({
  remoteDir: SshConsolePathSchema.optional(),
});
export type SshConsoleTerminalCreate = z.infer<typeof SshConsoleTerminalCreateSchema>;

export type SshConsoleHost = ResourceHost & {
  cpuCores: number | null;
  system: string | null;
  uptimeSeconds: number | null;
};
export type SshConsoleDisk = {
  filesystem: string;
  mount: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
};
export type SshConsoleOverview = {
  serverId: string;
  remoteDir: string;
  host: ResourceReading<SshConsoleHost>;
  disk: ResourceReading<SshConsoleDisk[]>;
};
export type SshConsoleProcess = {
  pid: number;
  ppid: number;
  user: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  memoryBytes: number | null;
  threads: number | null;
  elapsed: string;
  state: string;
  command: string;
};
export type SshConsoleGpuProcess = {
  pid: number;
  gpuUuid: string;
  gpuIndex: number | null;
  memoryBytes: number | null;
  user: string | null;
  command: string | null;
};
export type SshConsoleProcesses = {
  serverId: string;
  sampledAt: number | null;
  processes: SshConsoleProcess[];
  gpuProcesses: SshConsoleGpuProcess[];
  gpuProcessesAvailable: boolean;
  truncated: boolean;
  stale: boolean;
  message: string | null;
};
export type SshConsoleFileEntry = {
  name: string;
  path: string;
  type: 'directory' | 'file' | 'link' | 'other';
  size: number | null;
  modifiedAt: number | null;
};
export type SshConsoleDirectory = {
  serverId: string;
  path: string;
  parentPath: string;
  entries: SshConsoleFileEntry[];
  truncated: boolean;
};
export type SshConsolePreview = {
  serverId: string;
  path: string;
  text: string;
  size: number;
  binary: boolean;
  truncated: boolean;
};
export type SshConsoleTerminal = {
  id: string;
  serverId: string;
  cols: number;
  rows: number;
  startDir: string;
  startedAt: number;
  exited: boolean;
  exitCode: number | null;
  signal: string | null;
  /** 累计输出字节数；不是本次读取的下一游标。 */
  seq: number;
  /** 仍保留的最早字节位置。 */
  start: number;
  inputPaused: boolean;
};
export type SshConsoleTerminalRead = SshConsoleTerminal & {
  data: string;
  /** 按本次实际返回的字节数推进，前端必须保存此值继续读取。 */
  nextSeq: number;
  /** 游标早于保留窗口时重置终端显示，再写入 data。 */
  reset: boolean;
};
