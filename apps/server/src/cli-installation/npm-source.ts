import path from 'node:path';
import { resolveNodeExecutable, type ResolvedCommand } from '../platform/process/executable';
import type { AgentKind } from '@agentdeck/shared/conversation';
import {
  canonical,
  commandFingerprint,
  objectValue,
  PACKAGES,
  pathDirectories,
  readSmallFile,
  samePath,
  type BackendContext,
} from './backend-support';

type PackageInfo = { root: string; manifest: Record<string, unknown>; text: string };
export type NpmInstallation = { command: ResolvedCommand; prefix: string; identity: unknown };

async function packageInfo(root: string, name: string): Promise<PackageInfo | undefined> {
  try {
    const text = await readSmallFile(path.join(root, 'package.json'));
    const manifest = objectValue(JSON.parse(text));
    if (manifest?.name === name) return { root, manifest, text };
  } catch {
    /* 无法验证的包不能作为自动更新目标。 */
  }
  return undefined;
}

function declaredBin(info: PackageInfo, name: string): string | undefined {
  const bin = typeof info.manifest.bin === 'string' ? info.manifest.bin : objectValue(info.manifest.bin)?.[name];
  if (typeof bin !== 'string' || path.isAbsolute(bin)) return undefined;
  const resolved = path.resolve(info.root, bin);
  const relative = path.relative(info.root, resolved);
  return relative.startsWith('..') ? undefined : resolved;
}

async function npmCommand(
  dir: string,
  context: BackendContext,
  env: NodeJS.ProcessEnv,
): Promise<ResolvedCommand | undefined> {
  const entry = await canonical(path.join(dir, context.platform === 'win32' ? 'npm.cmd' : 'npm'));
  if (!entry) return undefined;
  const root = context.platform === 'win32' ? path.join(dir, 'node_modules/npm') : path.dirname(path.dirname(entry));
  const info = await packageInfo(root, 'npm');
  if (!info) return undefined;
  const bin = declaredBin(info, 'npm');
  if (!bin || !(await canonical(bin))) return undefined;
  if (context.platform !== 'win32' && !samePath(entry, (await canonical(bin))!, context.platform)) return undefined;
  // npm.cmd 不经 shell 执行：使用本机 Node 和已核对包名的 npm-cli.js。
  return { command: resolveNodeExecutable(dir, env), args: [bin] };
}

export async function discoverNpm(
  context: BackendContext,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<NpmInstallation | undefined> {
  for (const dir of pathDirectories(env, context.platform)) {
    try {
      const command = await npmCommand(dir, context, env);
      if (!command) continue;
      const result = await context.run(command.command, [...command.args, 'prefix', '--global'], {
        env,
        signal,
        timeoutMs: 8_000,
        outputCap: 16 * 1024,
      });
      const prefix = result.stdout.toString('utf8').trim();
      if (result.exitCode !== 0 || !path.isAbsolute(prefix) || /[\r\n\0]/.test(prefix)) return undefined;
      return { command, prefix: path.resolve(prefix), identity: await commandFingerprint(command) };
    } catch {
      /* 只跳过不可用的 npm；不执行任意包装脚本。 */
    }
  }
  return undefined;
}

export function npmBinDirectory(npm: NpmInstallation, platform: NodeJS.Platform): string {
  return platform === 'win32' ? npm.prefix : path.join(npm.prefix, 'bin');
}

async function matchesPackageEntry(
  info: PackageInfo,
  command: ResolvedCommand,
  input: { agent: AgentKind; context: BackendContext },
): Promise<boolean> {
  const bin = declaredBin(info, input.agent);
  if (!bin || command.args.length > 1) return false;
  if (command.args.length === 1 && !/^node(?:\.exe)?$/i.test(path.basename(command.command))) return false;
  const expected = await canonical(bin);
  const actual = await canonical(command.args[0] ?? command.command);
  if (!expected || !actual || !samePath(expected, actual, input.context.platform)) return false;
  return isPackageFile(info.root, actual);
}

async function isPackageFile(dir: string, file: string): Promise<boolean> {
  const root = await canonical(dir);
  if (!root) return false;
  const relative = path.relative(root, file);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export type OfficialPackage = { identity: string; version: unknown };
export async function officialNpmSource(input: {
  agent: AgentKind;
  command: ResolvedCommand;
  npm: NpmInstallation;
  context: BackendContext;
}): Promise<OfficialPackage | undefined> {
  const { agent, command, npm, context } = input;
  if (agent === 'antigravity') return undefined;
  const root = path.join(
    npm.prefix,
    context.platform === 'win32' ? 'node_modules' : 'lib/node_modules',
    PACKAGES[agent],
  );
  const info = await packageInfo(root, PACKAGES[agent]);
  if (!info) return undefined;
  if (!(await matchesPackageEntry(info, command, { agent, context }))) return undefined;
  // 对比真实入口与官方包声明的 bin，同时绑定完整清单；不依赖路径片段推断来源。
  return { identity: info.text, version: info.manifest.version };
}
