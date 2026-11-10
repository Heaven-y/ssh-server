import path from 'node:path';
import type { AgentKind } from '@agentdeck/shared/conversation';
import type { ResolvedCommand } from '../platform/process/executable';
import type { CliInstallation } from './types';
import {
  canonical,
  commandFingerprint,
  envValue,
  EXECUTABLES,
  GUIDES,
  hash,
  installationEnvironment,
  pathDirectories,
  samePath,
  VERSION,
  type BackendContext,
} from './backend-support';
import {
  discoverNpm,
  npmBinDirectory,
  officialNpmSource,
  type NpmInstallation,
  type OfficialPackage,
} from './npm-source';
import { applyClaudePolicy, claudePolicy } from './claude-policy';

async function currentVersion(
  command: ResolvedCommand,
  input: { context: BackendContext; env: NodeJS.ProcessEnv; signal?: AbortSignal },
): Promise<string | null> {
  try {
    const env = { ...input.env, AGY_CLI_DISABLE_AUTO_UPDATE: 'true', DISABLE_AUTOUPDATER: '1' };
    const result = await input.context.run(command.command, [...command.args, '--version'], {
      env,
      signal: input.signal,
      timeoutMs: 5_000,
      outputCap: 16 * 1024,
    });
    if (result.exitCode !== 0) return null;
    const version = `${result.stdout.toString('utf8')}\n${result.stderr.toString('utf8')}`
      .trim()
      .match(
        /^(?:codex-cli\s+|agy(?:\s+version)?\s+|Antigravity(?: CLI)?\s+)?v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)(?:\s|$)/i,
      )?.[1];
    return version && VERSION.test(version) ? version : null;
  } catch {
    return null;
  }
}

function nativeFile(agent: AgentKind, env: NodeJS.ProcessEnv, context: BackendContext): string | undefined {
  if (context.platform !== 'win32' || !['x64', 'arm64'].includes(context.arch)) return undefined;
  if (agent === 'claude') return path.join(context.homeDir, '.local/bin/claude.exe');
  const local = envValue(env, 'LOCALAPPDATA');
  if (agent === 'antigravity' && local) return path.join(local, 'agy/bin/agy.exe');
  if (agent === 'codex' && local)
    return path.join(envValue(env, 'CODEX_INSTALL_DIR') ?? path.join(local, 'Programs/OpenAI/Codex/bin'), 'codex.exe');
  return undefined;
}

async function codexNativeTarget(actual: string, env: NodeJS.ProcessEnv, context: BackendContext): Promise<boolean> {
  const home = envValue(env, 'CODEX_HOME') ?? path.join(context.homeDir, '.codex');
  const releases = await canonical(path.join(home, 'packages/standalone/releases'));
  if (!releases) return false;
  const relative = path.relative(releases, actual).replaceAll('\\', '/');
  // 官方 installer 建立 visible bin -> current -> releases/VERSION-TARGET 的目录链接。
  const target = context.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const [versionTarget, ...entry] = relative.split('/');
  if (!versionTarget?.endsWith(`-${target}`)) return false;
  const version = versionTarget.slice(0, -target.length - 1);
  return VERSION.test(version) && ['bin/codex.exe', 'codex.exe'].includes(entry.join('/'));
}

async function isNative(
  agent: AgentKind,
  command: ResolvedCommand,
  env: NodeJS.ProcessEnv,
  context: BackendContext,
): Promise<boolean> {
  const known = nativeFile(agent, env, context);
  if (!known || command.args.length > 0) return false;
  const [expected, actual] = await Promise.all([canonical(known), canonical(command.command)]);
  if (!expected || !actual || !samePath(expected, actual, context.platform)) return false;
  return agent !== 'codex' || codexNativeTarget(actual, env, context);
}

function explicitPath(agent: AgentKind, env: NodeJS.ProcessEnv): string | undefined {
  if (agent === 'claude') return envValue(env, 'CLAUDE_CODE_EXECUTABLE');
  if (agent === 'codex') return envValue(env, 'AGENTDECK_CODEX');
  return undefined;
}

function pathIncludes(dir: string, env: NodeJS.ProcessEnv, context: BackendContext): boolean {
  return pathDirectories(env, context.platform).some((entry) => samePath(entry, dir, context.platform));
}

type Capability = { allowed: boolean; message: string | null };
function codexInstallCapability(env: NodeJS.ProcessEnv, context: BackendContext): Capability {
  const local = envValue(env, 'LOCALAPPDATA');
  if (!local) return { allowed: false, message: '缺少本机安装目录，请按官方指引安装。' };
  const custom = envValue(env, 'CODEX_INSTALL_DIR');
  const known = path.join(local, 'Programs/OpenAI/Codex/bin');
  if (!custom || samePath(custom, known, context.platform) || pathIncludes(custom, env, context))
    return { allowed: true, message: null };
  return { allowed: false, message: 'Codex 自定义安装目录不在当前启动路径中，请先调整 PATH 并重启工作台。' };
}
function missingNativeCapability(agent: AgentKind, env: NodeJS.ProcessEnv, context: BackendContext): Capability {
  if (context.platform !== 'win32' || !['x64', 'arm64'].includes(context.arch))
    return { allowed: false, message: '当前平台的原生安装暂未适配，请按官方指引安装。' };
  if (agent === 'antigravity')
    return {
      allowed: !!envValue(env, 'LOCALAPPDATA'),
      message: envValue(env, 'LOCALAPPDATA') ? null : '缺少本机安装目录，请按官方指引安装。',
    };
  if (agent === 'codex') return codexInstallCapability(env, context);
  return { allowed: true, message: null };
}

function discoverableNpmDirectory(npm: NpmInstallation, env: NodeJS.ProcessEnv, context: BackendContext): boolean {
  const dir = npmBinDirectory(npm, context.platform);
  if (pathIncludes(dir, env, context)) return true;
  const appData = envValue(env, 'APPDATA');
  return context.platform === 'win32' && !!appData && samePath(dir, path.join(appData, 'npm'), context.platform);
}

function missingCapability(input: {
  agent: AgentKind;
  npm?: NpmInstallation;
  env: NodeJS.ProcessEnv;
  context: BackendContext;
}): Capability {
  const { agent, npm, env, context } = input;
  if (explicitPath(agent, env)) return { allowed: false, message: '显式指定的 CLI 启动路径不可用；请先修正该路径。' };
  if (!npm || agent === 'antigravity') return missingNativeCapability(agent, env, context);
  const allowed = discoverableNpmDirectory(npm, env, context);
  return { allowed, message: allowed ? null : 'npm 全局命令目录不在当前启动路径中，请先调整 PATH 并重启工作台。' };
}

async function installedSource(
  installation: CliInstallation,
  input: { context: BackendContext; env: NodeJS.ProcessEnv; signal?: AbortSignal; npm?: NpmInstallation },
): Promise<OfficialPackage | undefined> {
  const command = installation.command!;
  const { context, env, npm, signal } = input;
  installation.version = await currentVersion(command, { context, env, signal });
  const info = npm ? await officialNpmSource({ agent: installation.agent, command, npm, context }) : undefined;
  if (info) installation.source = 'npm';
  else if (await isNative(installation.agent, command, env, context)) installation.source = 'native';
  installation.canUpdate = installation.source !== 'unknown' && installation.version !== null;
  if (info && info.version !== installation.version) installation.canUpdate = false;
  if (!installation.canUpdate) installation.message = '无法确认 CLI 的官方安装来源或当前版本；请使用原安装方式更新。';
  return info;
}

function attachNpm(installation: CliInstallation, npm?: NpmInstallation): void {
  if (!npm || (installation.installed && installation.source !== 'npm')) return;
  installation.npm = npm.command;
  installation.prefix = npm.prefix;
}

export async function inspectInstallation(
  context: BackendContext,
  agent: AgentKind,
  signal?: AbortSignal,
): Promise<CliInstallation> {
  const inherited = await context.environment(agent);
  const env = installationEnvironment(inherited);
  const settings = agent === 'claude' ? await claudePolicy(env, context) : undefined;
  let command: ResolvedCommand | undefined;
  try {
    command = context.resolveCommand(EXECUTABLES[agent], inherited);
  } catch {
    /* 缺失或显式路径无效。 */
  }
  const npm = agent === 'antigravity' ? undefined : await discoverNpm(context, env, signal);
  const installation: CliInstallation = {
    agent,
    installed: !!command,
    version: null,
    source: command ? 'unknown' : 'missing',
    identity: '',
    command,
    canInstall: false,
    canUpdate: false,
    message: null,
    guideUrl: GUIDES[agent],
  };
  let packageIdentity: OfficialPackage | undefined;
  if (command) {
    packageIdentity = await installedSource(installation, { context, env, signal, npm });
  } else {
    const capability = missingCapability({ agent, npm, env: inherited, context });
    installation.canInstall = capability.allowed;
    installation.message = capability.message;
  }
  attachNpm(installation, npm);
  if (settings) applyClaudePolicy(installation, settings);
  installation.identity = hash({
    installation,
    files: await commandFingerprint(command),
    packageIdentity,
    npm: npm?.identity,
    settings: settings?.identity,
    environment: env,
    override: explicitPath(agent, inherited),
    platform: context.platform,
    arch: context.arch,
  });
  return installation;
}
