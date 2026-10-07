import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncSettingsSchema, type Workspace } from '@ssh-server/shared';
import type { ResolvedConnection } from '../../src/ssh/connection';
import type { ProcessOptions, ProcessResult } from '../../src/sync/process';
import { createRcloneDriver } from '../../src/sync/rclone';
import { workspaceStateDir } from '../../src/sync/inventory';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const ws: Workspace = {
  id: 'w1',
  name: 'demo',
  localDir: path.resolve('fixture-project'),
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
};
const key = Buffer.concat([
  Buffer.from([0, 0, 0, 11]),
  Buffer.from('ssh-ed25519'),
  Buffer.from([0, 0, 0, 32]),
  Buffer.alloc(32, 1),
]).toString('base64');
const connection: ResolvedConnection = {
  alias: 'my-server',
  hostname: 'example.invalid',
  port: 2222,
  username: 'demo',
  authMode: 'password',
  password: 'fixture-secret',
  cacheKey: 'generation-1',
  knownHostsFile: path.resolve('fixture-known-hosts'),
  knownHosts: `[example.invalid]:2222 ssh-ed25519 ${key}\nother ssh-ed25519 damaged!\n`,
};
function output(stdout: string, exitCode = 0, stderr = ''): ProcessResult {
  return { stdout: Buffer.from(stdout), stderr: Buffer.from(stderr), exitCode };
}
async function setup(version = 'rclone v1.75.1\n') {
  const configDir = await mkdtemp(path.join(process.env.PI_SCRATCH_DIR ?? os.tmpdir(), 'rclone-driver-test-'));
  temps.push(configDir);
  const calls: Array<{ args: string[]; options: ProcessOptions }> = [];
  const invalidations = new Set<() => void>();
  const run = vi.fn(async (_exe: string, args: string[], options: ProcessOptions) => {
    calls.push({ args, options: { ...options, env: { ...options.env } } });
    if (args[0] === 'version') return output(version);
    if (args[0] === 'obscure') return output('fixture-obscured\n');
    if (args[0] === 'lsjson') return output('[]');
    return output('');
  });
  const pool = {
    resolveConnection: vi.fn(async () => connection),
    exec: vi.fn(async () => ({
      stdout: '/projects/demo\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      truncated: false,
      durationMs: 1,
    })),
    invalidateCredentials: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    generation: vi.fn(() => 1),
    onCredentialsChanged: vi.fn((_alias: string, notify: () => void) => {
      invalidations.add(notify);
      return () => {
        invalidations.delete(notify);
      };
    }),
  };
  return {
    configDir,
    driver: createRcloneDriver({ configDir, pool, run, executable: 'fixture-rclone' }),
    calls,
    run,
    pool,
    invalidations,
  };
}
describe('rclone 隔离 SFTP 驱动', () => {
  it.each(['version', 'process'])('版本检查%s失败后重试，并发与后续成功只共用一个Promise', async (failure) => {
    const { driver, run } = await setup();
    if (failure === 'version') run.mockResolvedValueOnce(output('rclone v0.0.0\n'));
    else run.mockRejectedValueOnce(new Error('fixture process failure'));
    const settings = SyncSettingsSchema.parse({});
    await expect(driver.open(ws, settings)).rejects.toThrow();
    const contexts = await Promise.all(['w1', 'w2'].map((id) => driver.open({ ...ws, id }, settings)));
    contexts.push(await driver.open({ ...ws, id: 'w3' }, settings));
    for (const context of contexts) context.close();
    expect(run.mock.calls.filter(([, args]) => args[0] === 'version')).toHaveLength(2);
  });
  it('短逻辑根保留实际CSV映射，子进程成功或异常后清除凭据副本', async () => {
    const { driver, run, pool } = await setup();
    const remoteRoot = path.posix.join(path.posix.sep, 'projects', 'demo 中文 "quoted" ');
    pool.exec.mockResolvedValue({
      stdout: remoteRoot + '\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      truncated: false,
      durationMs: 1,
    });
    const localDir = path.resolve('fixture local 中文');
    const context = await driver.open(ws, SyncSettingsSchema.parse({}));
    let liveEnv: NodeJS.ProcessEnv | undefined;
    run.mockImplementationOnce(async (_exe, args, options) => {
      expect(args.slice(0, 3)).toEqual(['bisync', 'localview:root/', 'remoteview:root/']);
      liveEnv = options.env;
      expect(liveEnv).toMatchObject({
        RCLONE_CONFIG_WORKSPACE_PASS: 'fixture-obscured',
        RCLONE_CONFIG_LOCALVIEW_TYPE: 'combine',
        RCLONE_CONFIG_LOCALVIEW_UPSTREAMS: `"root=${localDir.split(path.sep).join('/')}"`,
        RCLONE_CONFIG_REMOTEVIEW_TYPE: 'combine',
        RCLONE_CONFIG_REMOTEVIEW_UPSTREAMS:
          '"root=workspace:' + path.posix.join(path.posix.sep, 'projects', 'demo 中文 ""quoted"" ') + '"',
      });
      return output('');
    });
    try {
      await context.bisync({ resync: true, allowAllDeletes: false, localDir });
      expect(context.baselineLayout).toBe('combine-v1');
      expect(liveEnv).not.toHaveProperty('RCLONE_CONFIG_WORKSPACE_PASS');
      run.mockImplementationOnce(async (_exe, _args, options) => {
        liveEnv = options.env;
        expect(liveEnv!.RCLONE_CONFIG_WORKSPACE_PASS).toBe('fixture-obscured');
        throw new Error('fixture interrupted');
      });
      await expect(context.bisync({ resync: false, allowAllDeletes: false })).rejects.toThrow('fixture interrupted');
      expect(liveEnv).not.toHaveProperty('RCLONE_CONFIG_WORKSPACE_PASS');
      expect(liveEnv).not.toHaveProperty('RCLONE_CONFIG_WORKSPACE_KEY_PEM');
    } finally {
      context.close();
    }
  });
  it('任务恢复只拉取受控镜像，固定镜像基线必须按远端优先重建', async () => {
    const { driver, calls, configDir } = await setup();
    const context = await driver.open(ws, SyncSettingsSchema.parse({ maxFileBytes: 64 }));
    try {
      const stateDir = workspaceStateDir(configDir, ws.id);
      const fixedMirror = path.join(stateDir, 'mirror');
      const taskMirror = path.join(stateDir, 'remote-file-snapshots', randomUUID(), 'mirror');
      const before = calls.length;
      await expect(context.pullMirror!(ws.localDir)).rejects.toMatchObject({ code: 'unsafe_path' });
      await expect(context.pullMirror!(fixedMirror)).rejects.toMatchObject({ code: 'unsafe_path' });
      await expect(
        context.bisync({
          resync: true,
          allowAllDeletes: true,
          remoteAuthoritative: true,
          localDir: ws.localDir,
        }),
      ).rejects.toMatchObject({ code: 'unsafe_path' });
      expect(calls).toHaveLength(before);
      await context.pullMirror!(taskMirror);
      const pulling = calls.at(-1)!.args;
      expect(pulling.slice(0, 3)).toEqual(['sync', 'workspace:/projects/demo', taskMirror]);
      expect(pulling).toContain('--delete-excluded');
      expect(pulling.slice(pulling.indexOf('--max-size'), pulling.indexOf('--max-size') + 2)).toEqual([
        '--max-size',
        '64B',
      ]);
      await context.bisync({
        resync: true,
        allowAllDeletes: true,
        allowAllChanges: true,
        remoteAuthoritative: true,
        localDir: fixedMirror,
      });
      const rebuilding = calls.at(-1)!.args;
      expect(rebuilding.slice(0, 3)).toEqual(['bisync', 'localview:root/', 'remoteview:root/']);
      expect(calls.at(-1)!.options.env!.RCLONE_CONFIG_LOCALVIEW_UPSTREAMS).toBe(
        `"root=${fixedMirror.split(path.sep).join('/')}"`,
      );
      expect(rebuilding.slice(rebuilding.indexOf('--resync-mode'), rebuilding.indexOf('--resync-mode') + 2)).toEqual([
        '--resync-mode',
        'path2',
      ]);
      expect(rebuilding).toContain('--force');
    } finally {
      context.close();
    }
  });
  it('密码经 stdin 混淆，只留子进程环境；不信任未知主机或降级私钥', async () => {
    const { driver, calls } = await setup();
    const context = await driver.open(ws, SyncSettingsSchema.parse({}));
    await context.bisync({ resync: false, allowAllDeletes: false });
    const obscuring = calls.find((call) => call.args[0] === 'obscure')!;
    expect(obscuring.options.input).toBe('fixture-secret');
    expect(obscuring.args).toEqual(['obscure', '-']);
    const syncing = calls.find((call) => call.args[0] === 'bisync')!;
    expect(syncing.args.join(' ')).not.toContain('fixture-secret');
    expect(syncing.options.env).toMatchObject({
      RCLONE_CONFIG_WORKSPACE_TYPE: 'sftp',
      RCLONE_CONFIG_WORKSPACE_HOST: 'example.invalid',
      RCLONE_CONFIG_WORKSPACE_PASS: 'fixture-obscured',
      RCLONE_CONFIG_WORKSPACE_KEY_USE_AGENT: 'false',
      RCLONE_CONFIG_WORKSPACE_SKIP_LINKS: 'true',
      RCLONE_CONFIG_WORKSPACE_SHELL_TYPE: 'none',
    });
    expect(syncing.options.env).not.toHaveProperty('RCLONE_CONFIG_WORKSPACE_KEY_FILE');
    const trustFile = syncing.options.env!.RCLONE_CONFIG_WORKSPACE_KNOWN_HOSTS_FILE!;
    expect(trustFile).not.toBe(connection.knownHostsFile);
    expect(await readFile(trustFile, 'utf8')).toBe(`[example.invalid]:2222 ssh-ed25519 ${key}\n`);
    expect(syncing.args).toContain('--filters-file');
    expect(syncing.args).toContain('--conflict-resolve');
    expect(syncing.args).not.toContain('--resync');
    expect(syncing.args).not.toContain('--check-access');
    expect(syncing.args).not.toContain('--backup-dir');
    context.close();
  });
  it('内联私钥使用官方要求的转义换行，只放环境中', async () => {
    const { driver, calls, pool, run } = await setup();
    const privateKey = Buffer.from(
      '-----BEGIN OPENSSH PRIVATE KEY-----\r\nfixture-key\r\n-----END OPENSSH PRIVATE KEY-----\r\n',
    );
    pool.resolveConnection.mockResolvedValue({ ...connection, authMode: 'key', password: undefined, privateKey });
    const context = await driver.open(ws, SyncSettingsSchema.parse({}));
    await context.bisync({ resync: true, allowAllDeletes: false });
    const transfer = calls.find((call) => call.args[0] === 'bisync')!;
    expect(transfer.options.env!.RCLONE_CONFIG_WORKSPACE_KEY_PEM).toBe(
      '-----BEGIN OPENSSH PRIVATE KEY-----\\nfixture-key\\n-----END OPENSSH PRIVATE KEY-----\\n',
    );
    expect(transfer.options.env).not.toHaveProperty('RCLONE_CONFIG_WORKSPACE_PASS');
    expect(transfer.args.join(' ')).not.toContain('fixture-key');
    run.mockResolvedValueOnce(output('', 1, 'authentication failed'));
    await expect(context.bisync({ resync: false, allowAllDeletes: false })).rejects.toThrow('rclone');
    expect(pool.disconnect).toHaveBeenCalledWith('my-server', 1);
    expect(pool.invalidateCredentials).not.toHaveBeenCalled();
    context.close();
  });
  it('版本不一致时停止，不执行 SSH 或传输', async () => {
    const { driver, calls, pool } = await setup('rclone v1.74.0\n');
    await expect(driver.open(ws, SyncSettingsSchema.parse({}))).rejects.toMatchObject({ code: 'version_mismatch' });
    expect(pool.exec).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });
  it('恢复小文件使用有上限的读取，本地重新出现时不覆盖', async () => {
    const { driver, run, calls } = await setup();
    const localDir = await mkdtemp(path.join(process.env.PI_SCRATCH_DIR ?? os.tmpdir(), 'restore-test-'));
    temps.push(localDir);
    await mkdir(path.join(localDir, 'sub'));
    const context = await driver.open({ ...ws, localDir }, SyncSettingsSchema.parse({ maxFileBytes: 10 }));
    run.mockResolvedValueOnce(output('remote'));
    await context.restore('sub/result.txt');
    expect(await readFile(path.join(localDir, 'sub/result.txt'), 'utf8')).toBe('remote');
    await writeFile(path.join(localDir, 'sub/result.txt'), 'new local', 'utf8');
    run.mockResolvedValueOnce(output('new remote'));
    await context.restore('sub/result.txt');
    expect(await readFile(path.join(localDir, 'sub/result.txt'), 'utf8')).toBe('new local');
    expect(calls.some((call) => call.args[0] === 'copyto')).toBe(false);
    run.mockResolvedValueOnce(output('x'.repeat(11)));
    await expect(context.restore('oversized.txt')).rejects.toMatchObject({ code: 'filter_changed' });
    await expect(readFile(path.join(localDir, 'oversized.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    context.close();
  });

  it('越界路径不传递给 rclone，原始 stderr 不回显', async () => {
    const { driver, run, pool } = await setup();
    const context = await driver.open(ws, SyncSettingsSchema.parse({}));
    await expect(context.restore('../outside')).rejects.toMatchObject({ code: 'unsafe_path' });
    run.mockResolvedValueOnce(output('', 1, 'private-config-secret'));
    await expect(context.bisync({ resync: false, allowAllDeletes: false })).rejects.toThrow('rclone');
    expect(pool.invalidateCredentials).not.toHaveBeenCalled();
    run.mockResolvedValueOnce(output('', 1, 'authentication failed'));
    await expect(context.bisync({ resync: false, allowAllDeletes: false })).rejects.toThrow('rclone');
    expect(pool.invalidateCredentials).toHaveBeenCalledWith('my-server', 1);
    context.close();
  });
  it('活动传输在断开后取消，迟到结果不能报告成功或清除新凭据', async () => {
    const { driver, run, pool, invalidations } = await setup();
    const context = await driver.open(ws, SyncSettingsSchema.parse({}));
    run.mockImplementationOnce((_exe, _args, options) => {
      pool.generation.mockReturnValue(2);
      for (const notify of invalidations) notify();
      expect(options.signal?.aborted).toBe(true);
      return Promise.resolve(output('', 1, 'authentication failed'));
    });
    await expect(context.bisync({ resync: false, allowAllDeletes: false })).rejects.toMatchObject({
      code: 'credentials_changed',
    });
    expect(pool.invalidateCredentials).not.toHaveBeenCalled();
    context.close();
    expect(invalidations.size).toBe(0);
  });
});
