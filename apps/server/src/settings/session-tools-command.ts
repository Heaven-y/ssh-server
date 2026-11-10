import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export type SessionToolsCommand = { command: string; args: string[]; env?: Record<string, string> };
type Options = { electron?: boolean; moduleUrl?: string; execPath?: string; env?: NodeJS.ProcessEnv; homeDir?: string };

function historyEnvironment(options: Options): Record<string, string> {
  const inherited = options.env ?? process.env;
  const homeDir = path.resolve(
    options.homeDir ?? (process.platform === 'win32' ? inherited.USERPROFILE : inherited.HOME) ?? os.homedir(),
  );
  // MCP 调用方可能使用临时 profile；SDK 历史根始终取工作台原始环境，不携带密钥。
  return {
    HOME: homeDir,
    USERPROFILE: homeDir,
    CODEX_HOME: path.resolve(inherited.CODEX_HOME || path.join(homeDir, '.codex')),
    CLAUDE_CONFIG_DIR: path.resolve(inherited.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude')),
  };
}

/** stdio 服务直接启动自身入口，不依赖用户工作目录或 shell。 */
export function buildSessionToolsCommand(configDir: string, options: Options = {}): SessionToolsCommand {
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  const command = options.execPath ?? process.execPath;
  const env = historyEnvironment(options);
  const args = ['--config-dir', path.resolve(configDir)];
  if (options.electron ?? !!process.versions.electron) {
    return {
      command,
      args: [fileURLToPath(new URL('./session-tools.mjs', moduleUrl)), ...args],
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    };
  }
  return {
    command,
    env,
    // Windows 的 --import 需要 file URL，避免盘符被解释为 URL scheme。
    args: [
      '--import',
      import.meta.resolve('tsx'),
      fileURLToPath(new URL('../session-tools/main.ts', moduleUrl)),
      ...args,
    ],
  };
}
