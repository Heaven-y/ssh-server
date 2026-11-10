import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CliInstallation } from './types';
import type { ResolvedCommand } from '../platform/process/executable';
import {
  BackendError,
  envValue,
  installationEnvironment,
  PACKAGES,
  safeFailure,
  VERSION,
  type BackendContext,
} from './backend-support';
import { INSTALLERS, officialText } from './catalog';

async function executeCommand(
  context: BackendContext,
  command: ResolvedCommand,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<void> {
  const result = await context.operationRun(command.command, command.args, {
    env,
    signal,
    cwd: context.homeDir,
    timeoutMs: 300_000,
    outputCap: 1024 * 1024,
  });
  if (result.exitCode !== 0)
    throw new BackendError('execution_failed', 'CLI 安装或更新执行失败；请检查网络、目录写入权限与官方安装指引。');
}

async function nativeInstaller(
  context: BackendContext,
  installation: CliInstallation,
  input: { env: NodeJS.ProcessEnv; version: string; signal: AbortSignal },
): Promise<void> {
  if (context.platform !== 'win32')
    throw new BackendError('unsupported_platform', '当前平台不支持自动原生安装，请查看官方指引。');
  const contents = await officialText(context, INSTALLERS[installation.agent], {
    signal: input.signal,
    cap: 512 * 1024,
  });
  const dir = await mkdtemp(path.join(tmpdir(), 'agentdeck-cli-installer-'));
  try {
    const file = path.join(dir, 'install.ps1');
    await writeFile(file, contents, { encoding: 'utf8', mode: 0o600 });
    const systemRoot = envValue(input.env, 'SystemRoot') ?? process.env.SystemRoot ?? 'C:\\Windows';
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file];
    if (installation.agent === 'claude') args.push(input.version);
    if (installation.agent === 'codex') {
      args.push('-Release', input.version);
      input.env.CODEX_NON_INTERACTIVE = '1';
      input.env.OS = 'Windows_NT';
    }
    await executeCommand(
      context,
      { command: path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), args },
      input.env,
      input.signal,
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function npmInstallCommand(installation: CliInstallation, version: string): ResolvedCommand | undefined {
  if (!installation.npm || !installation.prefix || installation.agent === 'antigravity') return undefined;
  const scope = installation.agent === 'claude' ? '@anthropic-ai' : '@openai';
  return {
    command: installation.npm.command,
    args: [
      ...installation.npm.args,
      'install',
      '--global',
      '--prefix',
      installation.prefix,
      // CLI 选项优先于用户/全局 npmrc；只设 registry 环境变量无法覆盖 scope registry。
      '--registry=https://registry.npmjs.org',
      `--${scope}:registry=https://registry.npmjs.org`,
      '--strict-ssl=true',
      `${PACKAGES[installation.agent]}@${version}`,
    ],
  };
}

export async function executeInstallation(
  context: BackendContext,
  installation: CliInstallation,
  version: string,
  signal: AbortSignal,
): Promise<void> {
  if (!VERSION.test(version) || version.length > 100)
    throw new BackendError('version_invalid', '版本号无效，请重新检查更新。');
  if (signal.aborted) throw new BackendError('aborted', 'CLI 操作已取消。');
  const env = installationEnvironment(await context.environment(installation.agent));
  const npm = npmInstallCommand(installation, version);
  try {
    if (npm) {
      await executeCommand(context, npm, env, signal);
    } else if (
      installation.installed &&
      installation.source === 'native' &&
      installation.command &&
      installation.agent !== 'codex'
    ) {
      await executeCommand(
        context,
        { command: installation.command.command, args: [...installation.command.args, 'update'] },
        env,
        signal,
      );
    } else await nativeInstaller(context, installation, { env, version, signal });
  } catch (error) {
    throw safeFailure(error);
  }
}
