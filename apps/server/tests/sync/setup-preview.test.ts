import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '@ssh-server/shared';
import type { SshPool } from '../../src/ssh/pool';
import { readRcloneMetadata } from '../../src/sync/rclone';
import type { ProcessRunner } from '../../src/sync/process';

vi.mock('../../src/ssh/metadata-exec', () => ({
  executeMetadataCommand: () => Promise.resolve(path.posix.join(path.posix.sep, 'fixture-home', 'project') + '\n'),
}));
const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const key = Buffer.concat([
  Buffer.from([0, 0, 0, 11]),
  Buffer.from('ssh-ed25519'),
  Buffer.from([0, 0, 0, 32]),
  Buffer.alloc(32, 1),
]).toString('base64');
describe('独立rclone只读清单', () => {
  it.each(['正常', '取消', '超限', '版本不符'] as const)('%s预览只运行元数据命令并清理临时状态', async (mode) => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'setup-preview-test-'));
    temps.push(configDir);
    const signal = new AbortController();
    const calls: string[][] = [];
    const run: ProcessRunner = (_exe, args, options) => {
      calls.push(args);
      if (args[0] === 'version') {
        expect(options.signal).toBe(signal.signal);
        return Promise.resolve({
          exitCode: 0,
          stdout: Buffer.from(`rclone v${mode === '版本不符' ? '1.74.0' : '1.75.1'}\n`),
          stderr: Buffer.alloc(0),
        });
      }
      if (mode === '取消') signal.abort();
      const files = Array.from({ length: mode === '超限' ? 20001 : 1 }, (_, i) => ({
        Path: `file-${i}.py`,
        Size: 5,
        ModTime: '2026-10-05T00:00:00Z',
        IsDir: false,
      }));
      return Promise.resolve({ exitCode: 0, stdout: Buffer.from(JSON.stringify(files)), stderr: Buffer.alloc(0) });
    };
    const pool = {
      generation: () => 1,
      resolveConnection: () =>
        Promise.resolve({
          cacheKey: 'original',
          hostname: 'example.invalid',
          port: 22,
          username: 'demo',
          authMode: 'key',
          privateKey: Buffer.from('fixture-key'),
          knownHosts: `example.invalid ssh-ed25519 ${key}\n`,
        }),
      onCredentialsChanged: () => () => undefined,
    } as unknown as SshPool;
    const workspace: Workspace = {
      id: 'fixture',
      name: '演示',
      sshHost: 'my-server',
      localDir: configDir,
      remoteDir: '~/projects/demo',
    };
    const result = readRcloneMetadata({ configDir, pool, run, executable: 'fixture-rclone' }, workspace, signal.signal);
    if (mode === '正常')
      expect(await result).toEqual([{ path: 'file-0.py', size: 5, modTime: '2026-10-05T00:00:00Z' }]);
    else if (mode === '取消') await expect(result).rejects.toThrow();
    else await expect(result).rejects.toMatchObject({ code: mode === '超限' ? 'inventory_limit' : 'version_mismatch' });
    expect(calls.map((args) => args[0])).toEqual(mode === '版本不符' ? ['version'] : ['version', 'lsjson']);
    expect(await readdir(configDir)).toEqual([]);
  });
});
