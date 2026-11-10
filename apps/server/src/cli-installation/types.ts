import type { AgentKind } from '@agentdeck/shared/conversation';
import type { CliInstallSource } from '@agentdeck/shared/settings';
import type { ResolvedCommand } from '../platform/process/executable';

/** 只在后端保存安装身份；路径、命令与环境不进入 HTTP 状态。 */
export type CliInstallation = {
  agent: AgentKind;
  installed: boolean;
  version: string | null;
  source: CliInstallSource;
  identity: string;
  command?: ResolvedCommand;
  prefix?: string;
  npm?: ResolvedCommand;
  channel?: 'latest' | 'stable';
  canInstall: boolean;
  canUpdate: boolean;
  message: string | null;
  guideUrl: string;
};

export type CliRelease = { version: string };
export type CliInstallationBackend = {
  inspect(agent: AgentKind, signal?: AbortSignal): Promise<CliInstallation>;
  latest(installation: CliInstallation, signal?: AbortSignal): Promise<CliRelease>;
  execute(installation: CliInstallation, version: string, signal: AbortSignal): Promise<void>;
};
