// 仅本机运行固定版本 rclone；同一个 SSH resolver 供执行与 SFTP 传输使用。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { SyncSettings, Workspace } from '@ssh-server/shared';
import { workspaceTarget, type ResolvedConnection } from '../ssh/connection';
import type { SshPool } from '../ssh/pool';
import { knownHostsForTarget } from '../ssh/known-hosts';
import { buildRemoteCommand } from '../ssh/remote-command';
import { SyncError } from './errors';
import { assertCompatiblePaths, eligibleFile, filterText, safeRelativePath } from './filters';
import { hash, safeLocalFile, workspaceStateDir, type FileEntry } from './inventory';
import { runProcess, type ProcessRunner } from './process';
import { executeMetadataCommand } from '../ssh/metadata-exec';

export type RcloneContext = {
  signature: string;
  listRemote(includeLarge?: boolean): Promise<FileEntry[]>;
  readRemote(file: string): Promise<Buffer>;
  restore(file: string): Promise<void>;
  moveRemote(from: string, to: string): Promise<void>;
  deleteRemote(file: string): Promise<void>;
  pullMirror?(localDir: string): Promise<void>;
  bisync(options: {
    resync: boolean;
    allowAllDeletes: boolean;
    allowAllChanges?: boolean;
    localDir?: string;
    remoteAuthoritative?: boolean;
  }): Promise<void>;
  close(): void;
};
export type SyncDriver = { open(ws: Workspace, settings: SyncSettings): Promise<RcloneContext> };
type Pool = Pick<
  SshPool,
  'exec' | 'resolveConnection' | 'disconnect' | 'invalidateCredentials' | 'generation' | 'onCredentialsChanged'
>;
type Deps = { configDir: string; pool: Pool; run?: ProcessRunner; executable?: string };
const ListSchema = z.array(
  z.object({ Path: z.string(), Size: z.number().int().nonnegative(), ModTime: z.string(), IsDir: z.boolean() }),
);
const RCLONE_VERSION = '1.75.1';
const PROCESS_CAP = 4 * 1024 * 1024;
const ENV_KEYS = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOME',
  'LOCALAPPDATA',
  'APPDATA',
];
function cleanEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => ENV_KEYS.includes(key.toUpperCase())));
}
async function remoteRoot(pool: Pool, ws: Workspace): Promise<string> {
  const result = await pool.exec(
    workspaceTarget(ws),
    buildRemoteCommand(
      ws.remoteDir,
      'test "$PWD" = "$(pwd -P)" && test -d . && test -r . && test -w . && test -x . && test -z "$(find . -type l -print -quit)" && pwd -P',
      20,
    ),
    { localTimeoutMs: 30_000, outputCap: 4096 },
  );
  const root = result.stdout.trim();
  if (result.exitCode !== 0 || result.timedOut || !root.startsWith('/') || /[\r\n\0]/.test(root))
    throw new SyncError('unsafe_remote', '服务器目录不可访问、不可写或含符号链接，同步已停止');
  return root;
}
async function remoteEnvironment(
  config: ResolvedConnection,
  obscure: (password: string) => Promise<string>,
  knownHostsFile: string,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = {
    ...cleanEnvironment(),
    RCLONE_CONFIG_WORKSPACE_TYPE: 'sftp',
    RCLONE_CONFIG_WORKSPACE_HOST: config.hostname,
    RCLONE_CONFIG_WORKSPACE_PORT: String(config.port),
    RCLONE_CONFIG_WORKSPACE_USER: config.username,
    RCLONE_CONFIG_WORKSPACE_KNOWN_HOSTS_FILE: knownHostsFile,
    RCLONE_CONFIG_WORKSPACE_KEY_USE_AGENT: 'false',
    RCLONE_CONFIG_WORKSPACE_ASK_PASSWORD: 'false',
    RCLONE_CONFIG_WORKSPACE_SKIP_LINKS: 'true',
    RCLONE_CONFIG_WORKSPACE_SHELL_TYPE: 'none',
    RCLONE_CONFIG_WORKSPACE_DISABLE_HASHCHECK: 'true',
  };
  if (config.authMode === 'password') env.RCLONE_CONFIG_WORKSPACE_PASS = await obscure(config.password!);
  else env.RCLONE_CONFIG_WORKSPACE_KEY_PEM = config.privateKey!.toString('utf8').replace(/\r\n?|\n/g, '\\n');
  return env;
}

async function checkRcloneVersion(run: ProcessRunner, executable: string, signal?: AbortSignal) {
  const version = await run(executable, ['version'], {
    env: cleanEnvironment(),
    timeoutMs: 5000,
    outputCap: 10000,
    signal,
  });
  if (version.exitCode !== 0 || !version.stdout.toString().startsWith(`rclone v${RCLONE_VERSION}\n`))
    throw new SyncError('version_mismatch', `同步和预览需要本机rclone ${RCLONE_VERSION}，请通过SSH_SERVER_RCLONE指定`);
}
function parsePreviewList(result: { exitCode: number | null; stdout: Buffer }): FileEntry[] {
  if (result.exitCode !== 0) throw new SyncError('preview_incomplete', '远端预览未完成，未生成总量');
  const files = ListSchema.parse(JSON.parse(result.stdout.toString()) as unknown).filter((entry) => !entry.IsDir);
  if (files.length > 20000) throw new SyncError('inventory_limit', '清单超过20000项，未完成统计');
  const entries = files.map((entry) => ({
    path: safeRelativePath(entry.Path),
    size: entry.Size,
    modTime: entry.ModTime,
  }));
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length)
    throw new SyncError('listing_invalid', '预览清单包含重复路径');
  assertCompatiblePaths(entries.map((entry) => entry.path));
  return entries;
}

/** 向导预览仅取得元数据；独立临时目录不包含同步基线，退出即清理。 */
export async function readRcloneMetadata(
  deps: { configDir: string; pool: SshPool; run?: ProcessRunner; executable?: string },
  workspace: Workspace,
  signal: AbortSignal,
): Promise<FileEntry[]> {
  signal.throwIfAborted();
  const run = deps.run ?? runProcess;
  const executable = deps.executable ?? process.env.SSH_SERVER_RCLONE ?? 'rclone';
  await checkRcloneVersion(run, executable, signal);
  const generation = deps.pool.generation(workspace.sshHost);
  const config = await deps.pool.resolveConnection(workspaceTarget(workspace));
  const root = (
    await executeMetadataCommand(deps.pool, workspaceTarget(workspace), {
      command: buildRemoteCommand(
        workspace.remoteDir,
        'test "$PWD" = "$(pwd -P)" && test -d . && test -r . && test -x . && test -z "$(find . -type l -print -quit)" && pwd -P',
        20,
      ),
      signal,
      timeoutMs: 22000,
      outputCap: 4096,
    })
  ).trim();
  if (!root.startsWith('/') || /[\r\n\0]/.test(root)) throw new SyncError('unsafe_remote', '远端目录不可安全读取');
  await mkdir(deps.configDir, { recursive: true });
  const temporary = await mkdtemp(path.join(deps.configDir, 'setup-preview-'));
  const credentialsChanged = new AbortController();
  const activeSignal = AbortSignal.any([signal, credentialsChanged.signal]);
  const unsubscribe = deps.pool.onCredentialsChanged(workspace.sshHost, () => credentialsChanged.abort());
  try {
    activeSignal.throwIfAborted();
    if (generation !== deps.pool.generation(workspace.sshHost))
      throw new SyncError('credentials_changed', '服务器认证已变化');
    const knownHostsFile = path.join(temporary, 'known_hosts');
    const trusted = knownHostsForTarget(config.knownHosts, config.hostname, config.port);
    if (!trusted) throw new SyncError('host_key_unknown', '预览前需要核对服务器主机指纹');
    await writeFile(knownHostsFile, trusted, { encoding: 'utf8', mode: 0o600 });
    const emptyConfig = path.join(temporary, 'rclone.conf');
    await writeFile(emptyConfig, '', { encoding: 'utf8', mode: 0o600 });
    const env = await remoteEnvironment(
      config,
      async (password) => {
        const result = await run(executable, ['obscure', '-'], {
          input: password,
          env: cleanEnvironment(),
          timeoutMs: 5000,
          outputCap: 10000,
          signal: activeSignal,
        });
        if (result.exitCode !== 0) throw new SyncError('obscure_failed', '预览认证转交失败');
        return result.stdout.toString().trim();
      },
      knownHostsFile,
    );
    const result = await run(
      executable,
      [
        'lsjson',
        `workspace:${root}`,
        '--recursive',
        '--files-only',
        '--exclude',
        '.git/**',
        '--exclude',
        '**/.git/**',
        '--ignore-case',
        '--config',
        emptyConfig,
        '--cache-dir',
        path.join(temporary, 'cache'),
        '--temp-dir',
        path.join(temporary, 'temp'),
        '--retries',
        '1',
        '--low-level-retries',
        '1',
        '--contimeout',
        '10s',
        '--timeout',
        '20s',
        '--log-level',
        'ERROR',
        '--stats',
        '0',
      ],
      { env, timeoutMs: 30000, outputCap: PROCESS_CAP, signal: activeSignal },
    );
    activeSignal.throwIfAborted();
    const current = await deps.pool.resolveConnection(workspaceTarget(workspace));
    if (current.cacheKey !== config.cacheKey || deps.pool.generation(workspace.sshHost) !== generation)
      throw new SyncError('credentials_changed', '服务器配置或认证已变化');
    return parsePreviewList(result);
  } finally {
    unsubscribe();
    await rm(temporary, { recursive: true, force: true });
  }
}

export function createRcloneDriver(deps: Deps): SyncDriver {
  const run = deps.run ?? runProcess;
  const executable = deps.executable ?? process.env.SSH_SERVER_RCLONE ?? 'rclone';
  let versionCheck: Promise<void> | undefined;
  async function ensureVersion(): Promise<void> {
    versionCheck ??= run(executable, ['version'], { env: cleanEnvironment(), timeoutMs: 5000, outputCap: 10_000 })
      .then((result) => {
        if (result.exitCode !== 0 || !result.stdout.toString().startsWith(`rclone v${RCLONE_VERSION}\n`))
          throw new SyncError(
            'version_mismatch',
            `同步需要本机 rclone ${RCLONE_VERSION}，请通过 SSH_SERVER_RCLONE 指定`,
          );
      })
      .catch((error: unknown) => {
        versionCheck = undefined;
        throw error;
      });
    await versionCheck;
  }
  async function open(ws: Workspace, settings: SyncSettings): Promise<RcloneContext> {
    await ensureVersion();
    const generation = deps.pool.generation(ws.sshHost);
    const config = await deps.pool.resolveConnection(workspaceTarget(ws));
    const root = await remoteRoot(deps.pool, ws);
    const stateDir = workspaceStateDir(deps.configDir, ws.id);
    const workDir = path.join(stateDir, 'bisync');
    await mkdir(workDir, { recursive: true });
    await mkdir(path.join(stateDir, 'temp'), { recursive: true });
    const filters = path.join(stateDir, 'filters.txt');
    const emptyConfig = path.join(stateDir, 'rclone.conf');
    await writeFile(filters, filterText(settings), 'utf8');
    await writeFile(emptyConfig, '', { encoding: 'utf8', mode: 0o600 });
    const knownHostsFile = path.join(stateDir, 'known_hosts');
    const trusted = knownHostsForTarget(config.knownHosts, config.hostname, config.port);
    if (!trusted)
      throw new SyncError('host_key_unknown', 'known_hosts 未登记有效的目标密钥，请先通过本机 ssh 核对指纹');
    await writeFile(knownHostsFile, trusted, { encoding: 'utf8', mode: 0o600 });
    const abort = new AbortController();
    const env = await remoteEnvironment(
      config,
      async (password) => {
        const result = await run(executable, ['obscure', '-'], {
          input: password,
          env: cleanEnvironment(),
          timeoutMs: 5000,
          outputCap: 10_000,
        });
        if (result.exitCode !== 0) throw new SyncError('obscure_failed', 'rclone 密码转交失败');
        return result.stdout.toString().trim();
      },
      knownHostsFile,
    );
    if (generation !== deps.pool.generation(ws.sshHost))
      throw new SyncError('credentials_changed', 'SSH 认证周期已结束，请重新连接');
    const unsubscribe = deps.pool.onCredentialsChanged(ws.sshHost, () => abort.abort());
    const remote = `workspace:${root}`;
    const common = [
      '--config',
      emptyConfig,
      '--cache-dir',
      path.join(stateDir, 'cache'),
      '--temp-dir',
      path.join(stateDir, 'temp'),
      '--log-level',
      'ERROR',
      '--stats',
      '0',
      '--retries',
      '1',
      '--low-level-retries',
      '1',
      '--contimeout',
      '20s',
      '--timeout',
      '60s',
    ];
    const filtering = ['--max-size', `${settings.maxFileBytes}B`, '--ignore-case'];
    async function assertCurrent(): Promise<void> {
      if (abort.signal.aborted || generation !== deps.pool.generation(ws.sshHost))
        throw new SyncError('credentials_changed', 'SSH 认证周期已结束，请重新连接');
      const current = await deps.pool.resolveConnection(workspaceTarget(ws));
      if (current.cacheKey !== config.cacheKey || generation !== deps.pool.generation(ws.sshHost))
        throw new SyncError('credentials_changed', 'SSH 认证周期已结束，请重新连接');
    }
    async function invoke(args: string[], cap = PROCESS_CAP): Promise<Buffer> {
      await assertCurrent();
      const result = await run(executable, [...args, ...common], {
        env,
        timeoutMs: 180_000,
        outputCap: cap,
        signal: abort.signal,
      });
      await assertCurrent();
      if (result.exitCode !== 0) {
        if (/unable to authenticate|authentication failed/i.test(result.stderr.toString())) {
          if (config.authMode === 'password') await deps.pool.invalidateCredentials(ws.sshHost, generation);
          else deps.pool.disconnect(ws.sshHost, generation);
        }
        throw new SyncError('rclone_failed', 'rclone 同步失败，请检查认证、网络、目录与本地同步状态；执行已暂停');
      }
      return result.stdout;
    }
    const fileRemote = (file: string) => `${remote}/${safeRelativePath(file)}`;
    function assertTaskMirror(directory: string, allowDefault = false) {
      if (allowDefault && path.resolve(directory) === path.resolve(stateDir, 'mirror')) return;
      const relative = path.relative(path.join(stateDir, 'remote-file-snapshots'), path.resolve(directory));
      const parts = relative.split(path.sep);
      if (parts.length !== 2 || !z.string().uuid().safeParse(parts[0]).success || parts[1] !== 'mirror')
        throw new SyncError('unsafe_path', '文件任务只能向独立受控镜像拉取，不允许覆盖工作区或其他目录');
    }
    async function readRemote(file: string): Promise<Buffer> {
      const data = await invoke(
        ['cat', fileRemote(file), '--head', String(settings.maxFileBytes + 1)],
        settings.maxFileBytes + 4096,
      );
      if (data.length > settings.maxFileBytes)
        throw new SyncError('filter_changed', '远端文件已超过同步上限，需重新确认初始化');
      return data;
    }
    return {
      signature: hash(
        JSON.stringify([config.hostname, config.port, config.username, root, path.resolve(ws.localDir), 'mirror-v1']),
      ),
      async listRemote(includeLarge = false) {
        const sizeFlags = includeLarge ? [] : filtering;
        const data: unknown = JSON.parse(
          (
            await invoke([
              'lsjson',
              remote,
              '--recursive',
              '--files-only',
              '--filter-from',
              filters,
              '--ignore-case',
              ...sizeFlags,
            ])
          ).toString(),
        );
        const parsed = ListSchema.safeParse(data);
        if (!parsed.success) throw new SyncError('listing_invalid', 'rclone 文件清单无效，已停止同步');
        const files = parsed.data
          .filter((file) => !file.IsDir)
          .map((file) => ({ path: safeRelativePath(file.Path), size: file.Size, modTime: file.ModTime }));
        if (new Set(files.map((file) => file.path)).size !== files.length)
          throw new SyncError('listing_invalid', '远端文件清单含重复路径，已停止同步');
        assertCompatiblePaths(files.map((file) => file.path));
        return files.filter((file) => includeLarge || eligibleFile(file.path, file.size, settings));
      },
      readRemote,
      async restore(file) {
        const local = await safeLocalFile(ws.localDir, file);
        const data = await readRemote(file);
        await writeFile(local, data, { flag: 'wx', mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
        });
      },
      async moveRemote(from, to) {
        await invoke(['moveto', fileRemote(from), fileRemote(to), '--immutable', '--ignore-existing']);
      },
      async deleteRemote(file) {
        await invoke(['deletefile', fileRemote(file)]);
      },
      async pullMirror(localDir) {
        assertTaskMirror(localDir);
        await invoke([
          'sync',
          remote,
          localDir,
          '--filter-from',
          filters,
          ...filtering,
          '--delete-excluded',
          '--checksum',
        ]);
      },
      async bisync(options) {
        const args = [
          'bisync',
          options.localDir ?? ws.localDir,
          remote,
          '--workdir',
          workDir,
          '--filters-file',
          filters,
          ...filtering,
          '--conflict-resolve',
          'none',
          '--conflict-loser',
          'num',
          '--conflict-suffix',
          'ssh-local-conflict,ssh-remote-conflict',
          '--compare',
          'size,modtime,checksum',
          '--download-hash',
          '--checksum',
        ];
        if (options.remoteAuthoritative) assertTaskMirror(options.localDir ?? ws.localDir, true);
        if (options.resync) args.push('--resync', '--resync-mode', options.remoteAuthoritative ? 'path2' : 'path1');
        if (options.allowAllDeletes) args.push('--max-delete', '100');
        // 状态机已核对目标、范围和删除决策；允许单文件工作区的全部内容变化。
        if (options.allowAllChanges) args.push('--force');
        await invoke(args);
      },
      close() {
        unsubscribe();
        abort.abort();
        delete env.RCLONE_CONFIG_WORKSPACE_PASS;
        delete env.RCLONE_CONFIG_WORKSPACE_KEY_PEM;
      },
    };
  }
  return { open };
}
