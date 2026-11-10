// 本机 CLI 的统一启动解析：只使用用户安装或显式覆盖的入口，不回退到 SDK 包内程序。
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ProcessError } from './run';

export type LocalExecutable = 'claude' | 'codex' | 'agy';
export type ResolvedCommand = { command: string; args: string[] };
const WINDOWS_EXTENSIONS = ['.exe', '.com', '.cmd', '.bat', '.ps1'];
const SCRIPT_EXTENSIONS = /\.(cjs|mjs|js)$/i;
const NATIVE_EXTENSIONS = /\.(exe|com)$/i;

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const entry = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function pathDirectories(env: NodeJS.ProcessEnv): string[] {
  const raw = envValue(env, 'PATH') ?? '';
  return raw
    .split(path.delimiter)
    .map((dir) => dir.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function findOnPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const extensions = process.platform === 'win32' ? WINDOWS_EXTENSIONS : [''];
  for (const dir of pathDirectories(env)) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${name}${extension}`);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

export function resolveNodeExecutable(dir: string, env: NodeJS.ProcessEnv): string {
  const local = path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
  if (isFile(local)) return local;
  if (!process.versions.electron) return process.execPath;
  const installed = findOnPath('node', env);
  if (installed && !/\.(cmd|bat|ps1)$/i.test(installed)) return installed;
  throw new ProcessError(
    'executable_missing',
    '脚本形式的 CLI 需要本机 Node，请检查 Node 安装或改用原生 CLI 可执行文件',
  );
}

/**
 * npm 全局安装会在 PATH 上留下 .cmd / .ps1 包装脚本，shell:false 无法直接执行它们。
 * 这里只解析脚本里真实存在的绝对路径：优先 .js 入口（用 node 启动），其次原生 .exe。
 */
function shimCandidates(text: string, dir: string): string[] {
  const expanded = text
    .replace(/%~dp0/gi, `${dir}${path.sep}`)
    .replace(/%dp0%/gi, `${dir}${path.sep}`)
    .replace(/\$basedir/gi, dir)
    .replace(/\$psscriptroot/gi, dir);
  const candidates: string[] = [];
  for (const match of expanded.matchAll(/["']([^"'\r\n]+)["']/g)) {
    const raw = match[1]?.trim();
    if (!raw || raw.includes('%') || raw.includes('$') || !path.isAbsolute(raw)) continue;
    const candidate = path.normalize(raw);
    if (isFile(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function resolveShim(file: string, env: NodeJS.ProcessEnv): ResolvedCommand {
  const candidates = shimCandidates(readFileSync(file, 'utf8'), path.dirname(file));
  const script = candidates.find((candidate) => SCRIPT_EXTENSIONS.test(candidate));
  if (script) return { command: resolveNodeExecutable(path.dirname(file), env), args: [script] };
  const native = candidates.find((candidate) => NATIVE_EXTENSIONS.test(candidate));
  if (native) return { command: native, args: [] };
  throw new ProcessError('executable_missing', `无法从 ${path.basename(file)} 解析出真实可执行文件`);
}

function resolveFile(file: string, env: NodeJS.ProcessEnv, overrideName?: string): ResolvedCommand {
  if (!isFile(file))
    throw new ProcessError(
      'executable_missing',
      overrideName ? `${overrideName} 指向的文件不存在` : `未找到可执行文件 ${path.basename(file)}`,
    );
  const extension = path.extname(file).toLowerCase();
  if (extension === '.cmd' || extension === '.bat' || extension === '.ps1') return resolveShim(file, env);
  if (SCRIPT_EXTENSIONS.test(file)) return { command: resolveNodeExecutable(path.dirname(file), env), args: [file] };
  return { command: file, args: [] };
}

function explicitOverride(
  executable: LocalExecutable,
  env: NodeJS.ProcessEnv,
): { name: string; value: string } | undefined {
  const names =
    executable === 'claude' ? ['CLAUDE_CODE_EXECUTABLE'] : executable === 'codex' ? ['AGENTDECK_CODEX'] : [];
  for (const name of names) {
    const value = envValue(env, name)
      ?.trim()
      .replace(/^"(.*)"$/, '$1');
    if (value) return { name, value };
  }
  return undefined;
}

/** 官方用户安装目录：新安装后无需修改当前进程 PATH，也不覆盖既有 PATH 选择。 */
function knownDirectories(executable: LocalExecutable, env: NodeJS.ProcessEnv): string[] {
  const home = envValue(env, 'USERPROFILE') ?? envValue(env, 'HOME');
  const local = envValue(env, 'LOCALAPPDATA');
  const roaming = envValue(env, 'APPDATA');
  const directories: string[] = [];
  if (executable === 'claude' && home) directories.push(path.join(home, '.local', 'bin'));
  if (executable === 'codex' && local) directories.push(path.join(local, 'Programs', 'OpenAI', 'Codex', 'bin'));
  if (roaming) directories.push(path.join(roaming, 'npm'));
  return directories;
}

function knownInstallation(executable: LocalExecutable, env: NodeJS.ProcessEnv): string | undefined {
  const candidate = findOnPath(executable, { PATH: knownDirectories(executable, env).join(path.delimiter) });
  if (candidate) return candidate;
  const local = envValue(env, 'LOCALAPPDATA');
  if (executable === 'agy' && local) {
    const agy = path.join(local, 'agy', 'bin', 'agy.exe');
    if (isFile(agy)) return agy;
  }
  return undefined;
}

export function resolveLocalCommand(
  executable: LocalExecutable,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedCommand {
  const override = explicitOverride(executable, env);
  if (override) return resolveFile(override.value, env, override.name);
  const found = findOnPath(executable, env);
  if (found) return resolveFile(found, env);
  const known = knownInstallation(executable, env);
  if (known) return resolveFile(known, env);
  throw new ProcessError('executable_missing', `未找到可执行文件 ${executable}`);
}
