import { access } from 'node:fs/promises';
import path from 'node:path';
import type { CodexRuntimeOptions } from './types';
import { CodexError } from './types';

type LaunchCommand = { command: string; args: string[] };
async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function officialNpmCommand(dir: string): Promise<LaunchCommand | undefined> {
  const root = path.join(dir, 'node_modules', '@openai', 'codex');
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const vendor = path.join('vendor', `${arch}-pc-windows-msvc`, 'bin', 'codex.exe');
  const packageName = `codex-win32-${process.arch}`;
  const candidates = [
    path.join(root, 'node_modules', '@openai', packageName, vendor),
    path.join(dir, 'node_modules', '@openai', packageName, vendor),
    path.join(root, vendor),
  ];
  for (const file of candidates) if (await exists(file)) return { command: file, args: [] };
  const entry = path.join(root, 'bin', 'codex.js');
  return (await exists(entry)) ? { command: process.execPath, args: [entry] } : undefined;
}

async function explicitCommand(command: string): Promise<LaunchCommand> {
  if (/\.(cmd|ps1|bat)$/i.test(command)) {
    const native = await officialNpmCommand(path.dirname(command));
    if (native) return native;
    throw new CodexError('请将 SSH_SERVER_CODEX 指向 Codex 可执行文件或官方 JavaScript 入口。');
  }
  return /\.[cm]?js$/i.test(command) ? { command: process.execPath, args: [command] } : { command, args: [] };
}

/** 不使用 shell；Windows 从 PATH 查找原生程序或已安装的官方 npm 入口。 */
export async function resolveCodexCommand(options: CodexRuntimeOptions = {}): Promise<LaunchCommand> {
  if (typeof options.command === 'object') return { ...options.command, args: options.command.args ?? [] };
  const env = { ...process.env, ...options.env };
  const explicit = options.command ?? env.SSH_SERVER_CODEX;
  if (explicit) return explicitCommand(explicit);
  if (process.platform !== 'win32') return { command: 'codex', args: [] };
  return windowsCommand(env);
}

async function windowsCommand(env: NodeJS.ProcessEnv): Promise<LaunchCommand> {
  const envPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const dir of envPath.split(path.delimiter).filter(Boolean)) {
    const exe = path.join(dir, 'codex.exe');
    if (await exists(exe)) return { command: exe, args: [] };
    const native = await officialNpmCommand(dir);
    if (native) return native;
  }
  throw new CodexError('找不到 Codex，请安装官方 CLI，或设置 SSH_SERVER_CODEX。');
}
