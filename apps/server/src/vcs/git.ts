import { runProcess } from '../sync/process';
import { SyncError } from '../sync/errors';
import { VersionError } from './errors';

export type GitOptions = {
  input?: string | Buffer;
  index?: string;
  attributes?: string;
  allowFailure?: boolean;
  outputCap?: number;
  literal?: boolean;
};
const CAP = 16 * 1024 * 1024;

/** 恢复必须支持 GIT_ATTR_SOURCE，旧版本不能静默使用当前工作树属性。 */
export function assertGitVersion(output: string): void {
  const version = /^git version (\d+)\.(\d+)(?:$|[.\s-])/.exec(output.trim());
  if (!version) throw new VersionError('git_version');
  const major = Number(version[1]);
  const minor = Number(version[2]);
  if (major < 2 || (major === 2 && minor < 43)) throw new VersionError('git_version');
}

export async function verifyGitVersion(cwd: string): Promise<void> {
  const version = await git(cwd, ['--version'], { allowFailure: true, outputCap: 1024 });
  if (version.exitCode !== 0) throw new VersionError('git_version');
  assertGitVersion(version.stdout.toString('utf8'));
}

function environment(options: GitOptions): NodeJS.ProcessEnv {
  // 避免继承其他仓库的 GIT_DIR/INDEX_FILE、跟踪输出或任意 Git 配置注入。
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' });
  if (options.literal !== false) env.GIT_LITERAL_PATHSPECS = '1';
  if (options.index) env.GIT_INDEX_FILE = options.index;
  if (options.attributes) env.GIT_ATTR_SOURCE = options.attributes;
  return env;
}

function processError(error: unknown): never {
  if (!(error instanceof SyncError)) throw error;
  if (error.code === 'executable_missing') throw new VersionError('git_missing');
  if (error.code === 'timeout') throw new VersionError('timeout');
  if (error.code === 'output_limit') throw new VersionError('limit_exceeded');
  throw new VersionError('git_error');
}

export async function git(cwd: string, args: string[], options: GitOptions = {}) {
  try {
    const result = await runProcess(
      'git',
      ['-C', cwd, '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', ...args],
      { env: environment(options), input: options.input, outputCap: options.outputCap ?? CAP, timeoutMs: 30_000 },
    );
    if (result.exitCode !== 0 && !options.allowFailure) throw new VersionError('git_error');
    return result;
  } catch (error) {
    processError(error);
  }
}

export function nulStrings(buffer: Buffer): string[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new VersionError('unsafe_path');
  }
  return text.split('\0').filter(Boolean);
}

export async function gitText(cwd: string, args: string[], options?: GitOptions): Promise<string> {
  return (await git(cwd, args, options)).stdout.toString('utf8').trim();
}
