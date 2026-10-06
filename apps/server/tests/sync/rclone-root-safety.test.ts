import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncSettingsSchema, type Workspace } from '@ssh-server/shared';
import type { SshPool } from '../../src/ssh/pool';
import { executeMetadataCommand } from '../../src/ssh/metadata-exec';
import { createRcloneDriver, readRcloneMetadata } from '../../src/sync/rclone';
import type { ProcessRunner } from '../../src/sync/process';

vi.mock('../../src/ssh/metadata-exec', () => ({ executeMetadataCommand: vi.fn() }));
const temps: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const key = Buffer.concat([
  Buffer.from([0, 0, 0, 11]),
  Buffer.from('ssh-ed25519'),
  Buffer.from([0, 0, 0, 32]),
  Buffer.alloc(32, 1),
]).toString('base64');

async function setup(stdout: string, truncated = false) {
  const configDir = await mkdtemp(path.join(process.env.PI_SCRATCH_DIR ?? os.tmpdir(), 'rclone-root-test-'));
  temps.push(configDir);
  const calls: string[][] = [];
  const run: ProcessRunner = async (_executable, args) => {
    calls.push(args);
    const text = args[0] === 'version' ? 'rclone v1.75.1\n' : '[]';
    return { stdout: Buffer.from(text), stderr: Buffer.alloc(0), exitCode: 0 };
  };
  const pool = {
    resolveConnection: async () => ({
      hostname: 'example.invalid',
      port: 22,
      username: 'demo',
      authMode: 'key',
      privateKey: Buffer.from('fixture-key'),
      knownHosts: `example.invalid ssh-ed25519 ${key}\n`,
      cacheKey: 'fixture-connection',
    }),
    exec: async () => ({ stdout, stderr: '', exitCode: 0, timedOut: false, truncated, durationMs: 1 }),
    generation: () => 1,
    onCredentialsChanged: () => () => undefined,
    disconnect: vi.fn(),
    invalidateCredentials: vi.fn(),
  } as unknown as SshPool;
  vi.mocked(executeMetadataCommand).mockResolvedValue(stdout);
  const workspace: Workspace = {
    id: 'fixture',
    name: '演示',
    localDir: configDir,
    sshHost: 'my-server',
    remoteDir: '~/projects/demo',
  };
  const deps = { configDir, pool, run, executable: 'fixture-rclone' };
  return {
    configDir,
    calls,
    async invoke(mode: '同步' | '预览') {
      if (mode === '预览') return readRcloneMetadata(deps, workspace, new AbortController().signal);
      const context = await createRcloneDriver(deps).open(workspace, SyncSettingsSchema.parse({}));
      try {
        return await context.listRemote();
      } finally {
        context.close();
      }
    },
  };
}

describe.each(['同步', '预览'] as const)('%s远端根精确绑定', (mode) => {
  it('只移除命令终止LF，保留Unicode和目录名尾随空格', async () => {
    const { invoke, calls } = await setup('/projects/中文 demo \n');
    await expect(invoke(mode)).resolves.toEqual([]);
    expect(calls.find((args) => args[0] === 'lsjson')?.[1]).toBe('workspace:/projects/中文 demo ');
  });

  it('Windows拒绝会被工具改写的反斜杠根，其他平台原样传递', async () => {
    const { invoke, calls, configDir } = await setup('/projects/demo\\root\n');
    if (process.platform === 'win32') {
      await expect(invoke(mode)).rejects.toMatchObject({
        code: 'unsafe_remote',
        message: expect.stringContaining('反斜杠'),
      });
      expect(calls.map((args) => args[0])).toEqual(['version']);
      expect(await readdir(configDir)).toEqual([]);
    } else {
      await expect(invoke(mode)).resolves.toEqual([]);
      expect(calls.find((args) => args[0] === 'lsjson')?.[1]).toBe('workspace:/projects/demo\\root');
    }
  });

  it.each([
    ['缺少终止符', '/projects/demo'],
    ['前置换行', '\n/projects/demo\n'],
    ['尾部额外换行', '/projects/demo\n\n'],
    ['回车', '/projects/demo\r\n'],
    ['NUL', '/projects/demo\0\n'],
    ['非绝对路径', 'projects/demo\n'],
    ['空输出', ''],
  ])('%s时拒绝启动数据命令和建立传输状态', async (_label, stdout) => {
    const { invoke, calls, configDir } = await setup(stdout);
    await expect(invoke(mode)).rejects.toMatchObject({ code: 'unsafe_remote' });
    expect(calls.map((args) => args[0])).toEqual(['version']);
    expect(await readdir(configDir)).toEqual([]);
  });
});

it('同步目录检查即使返回绝对路径和退出码0，截断结果也不能作为目标', async () => {
  const { invoke, calls, configDir } = await setup('/projects/demo\n', true);
  await expect(invoke('同步')).rejects.toMatchObject({ code: 'unsafe_remote' });
  expect(calls.map((args) => args[0])).toEqual(['version']);
  expect(await readdir(configDir)).toEqual([]);
});
