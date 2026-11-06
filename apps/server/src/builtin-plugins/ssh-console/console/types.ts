import type {
  SshConsoleDirectory,
  SshConsoleOverview,
  SshConsolePreview,
  SshConsoleProcesses,
  SshConsoleTerminal,
  SshConsoleTerminalCreate,
  SshConsoleTerminalRead,
  TerminalSize,
} from '@agentdeck/shared/ssh';
import type { SshPool } from '../ssh/pool';

export type SshConsoleDeps = { pool: SshPool; isEnabled(): boolean };
export type SshConsoleService = {
  overview(serverId: string, remoteDir?: string, signal?: AbortSignal): Promise<SshConsoleOverview>;
  processes(serverId: string, signal?: AbortSignal): Promise<SshConsoleProcesses>;
  listDirectory(serverId: string, directory?: string, signal?: AbortSignal): Promise<SshConsoleDirectory>;
  preview(serverId: string, file: string, signal?: AbortSignal): Promise<SshConsolePreview>;
  listTerminals(serverId: string): Promise<{ terminals: SshConsoleTerminal[] }>;
  createTerminal(serverId: string, input: SshConsoleTerminalCreate): Promise<SshConsoleTerminal>;
  readTerminal(serverId: string, terminalId: string, fromSeq: number): Promise<SshConsoleTerminalRead>;
  writeTerminal(serverId: string, terminalId: string, data: string): Promise<{ written: number }>;
  resizeTerminal(serverId: string, terminalId: string, size: TerminalSize): Promise<SshConsoleTerminal>;
  closeTerminal(serverId: string, terminalId: string): Promise<void>;
  /** 清理当前控制台拥有的通道；不主动断开共享 SSH，重新启用后可重新打开。 */
  dispose(): void;
};
