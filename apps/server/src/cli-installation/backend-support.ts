import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AgentKind } from '@agentdeck/shared/conversation';
import { ProcessError, type ProcessRunner } from '../platform/process/run';
import type { ResolvedCommand, resolveLocalCommand } from '../platform/process/executable';

export class BackendError extends Error {
  override name = 'BackendError';
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type BackendOptions = {
  environment?: (agent: AgentKind) => Promise<NodeJS.ProcessEnv>;
  run?: ProcessRunner;
  fetch?: typeof globalThis.fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  homeDir?: string;
  resolveCommand?: typeof resolveLocalCommand;
};
export type BackendContext = {
  environment: (agent: AgentKind) => Promise<NodeJS.ProcessEnv>;
  run: ProcessRunner;
  operationRun: ProcessRunner;
  fetch: typeof globalThis.fetch;
  platform: NodeJS.Platform;
  arch: string;
  homeDir: string;
  resolveCommand: typeof resolveLocalCommand;
};

export const EXECUTABLES = { claude: 'claude', codex: 'codex', antigravity: 'agy' } as const;
export const PACKAGES = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex' } as const;
export const GUIDES = {
  claude: 'https://code.claude.com/docs/en/setup',
  codex: 'https://developers.openai.com/codex/cli',
  antigravity: 'https://antigravity.google/docs/getting-started?tab=cli',
};
export const VERSION = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/;

export function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  return Object.entries(env).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
}
export function pathDirectories(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  return (envValue(env, 'PATH') ?? '')
    .split(platform === 'win32' ? ';' : ':')
    .map((dir) => dir.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}
export function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const normalize = (value: string) => (platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value));
  return normalize(a) === normalize(b);
}
export async function canonical(file: string): Promise<string | undefined> {
  try {
    return await realpath(file);
  } catch {
    return undefined;
  }
}
export async function fingerprint(file: string): Promise<unknown> {
  try {
    const resolved = await realpath(file);
    const info = await stat(resolved);
    return [resolved, info.size, info.mtimeMs, info.ctimeMs, info.ino];
  } catch {
    return null;
  }
}
export async function readSmallFile(file: string, limit = 256 * 1024): Promise<string> {
  const info = await stat(file);
  if (!info.isFile() || info.size > limit)
    throw new BackendError('file_invalid', '本机配置文件过大或无法识别，已停止自动操作。');
  const contents = await readFile(file);
  if (contents.length > limit) throw new BackendError('file_invalid', '本机配置文件过大，已停止自动操作。');
  return contents.toString('utf8').replace(/^\uFEFF/, '');
}
export function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// 只继承系统路径、代理、证书与本机安装所需目录；不继承模型凭据或 Node 注入选项。
const SAFE_ENV = new Set([
  'path',
  'os',
  'pathext',
  'systemroot',
  'windir',
  'comspec',
  'temp',
  'tmp',
  'tmpdir',
  'home',
  'userprofile',
  'localappdata',
  'appdata',
  'programdata',
  'programfiles',
  'programfiles(x86)',
  'processor_architecture',
  'processor_architew6432',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'ssl_cert_file',
  'ssl_cert_dir',
  'node_extra_ca_certs',
  'lang',
  'lc_all',
  'npm_config_prefix',
  'claude_config_dir',
  'codex_home',
  'codex_install_dir',
  'disable_updates',
]);
export function installationEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key, value]) => SAFE_ENV.has(key.toLowerCase()) && value !== undefined),
  );
}
export function safeFailure(error: unknown): BackendError {
  if (error instanceof BackendError) return error;
  if (error instanceof ProcessError && error.code === 'timeout')
    return new BackendError('timeout', 'CLI 操作超时，已停止；请检查本机安装后重试。');
  if (error instanceof ProcessError && error.code === 'aborted') return new BackendError('aborted', 'CLI 操作已取消。');
  if (error instanceof ProcessError && error.code === 'output_limit')
    return new BackendError('output_limit', 'CLI 操作输出超过上限，已停止。');
  return new BackendError('execution_failed', 'CLI 安装或更新执行失败；请检查网络、目录写入权限与官方安装指引。');
}
export async function commandFingerprint(command?: ResolvedCommand): Promise<unknown> {
  if (!command) return null;
  return { command, files: await Promise.all([command.command, ...command.args].map(fingerprint)) };
}
