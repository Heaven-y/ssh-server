import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SFTPWrapper } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '@ssh-server/shared';
import type { SshPool } from '../../src/ssh/pool';
import { inspectRemoteRoot } from '../../src/workspaces/setup/remote';
import { createSetupVerification } from '../../src/workspaces/setup/verification';
import { createWorkspaceStore } from '../../src/workspaces/store';

vi.mock('../../src/ssh/metadata-exec', () => ({ executeMetadataCommand: () => Promise.resolve('') }));
const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('向导核心审查回归', () => {
  it('读取目录期间同步根换成链接时必须拒绝', async () => {
    let changed = false;
    const channel = Object.assign(new EventEmitter(), {
      realpath: (value: string, done: (error: null, result: string) => void) =>
        done(null, value === '.' ? path.posix.join(path.posix.sep, 'fixture-home') : value),
      lstat: (value: string, done: (error: { code: number } | null, result?: unknown) => void) =>
        value.endsWith('.git')
          ? done({ code: 2 })
          : done(null, { isDirectory: () => !changed, isSymbolicLink: () => changed }),
      opendir: (_value: string, done: (error: null, handle: Buffer) => void) => {
        changed = true;
        done(null, Buffer.from('handle'));
      },
      readdir: (_handle: Buffer, done: (error: null, result: false) => void) => done(null, false),
      close: (_handle: Buffer, done: (error: null) => void) => done(null),
      end: () => undefined,
    });
    const pool = {
      generation: () => 1,
      resolveConnection: () => Promise.resolve({ cacheKey: 'original' }),
      openSftp: () => Promise.resolve(channel as unknown as SFTPWrapper),
    } as unknown as SshPool;
    const workspace: Workspace = {
      id: 'fixture',
      name: 'demo',
      localDir: path.resolve('fixture-project'),
      sshHost: 'my-server',
      remoteDir: path.posix.join(path.posix.sep, 'fixture-home', 'project'),
    };
    await expect(inspectRemoteRoot(pool, workspace, new AbortController().signal)).rejects.toMatchObject({
      code: 'remote_directory_invalid',
    });
  });

  it.each(['创建开始', '写盘前复验'] as const)('%s期间resolver挂起时取消必须释放队列且不保存', async (phase) => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'setup-review-'));
    temps.push(configDir);
    let calls = 0;
    let blockedAt = Number.POSITIVE_INFINITY;
    let entered!: () => void;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pool = {
      generation: () => 1,
      resolveConnection: async () => {
        if (++calls === blockedAt) {
          entered();
          await gate;
        }
        return { cacheKey: 'original' };
      },
    } as unknown as SshPool;
    const store = createWorkspaceStore({
      configDir,
      knownHosts: () => Promise.resolve(['my-server']),
      dirExists: () => Promise.resolve(true),
    });
    const sync = { initialize: vi.fn(), status: vi.fn() };
    const input = { name: 'demo', localDir: configDir, sshHost: 'my-server', remoteDir: '~/projects/demo' };
    const verification = createSetupVerification({
      pool,
      store,
      sync,
      inspectRemote: () =>
        Promise.resolve({ path: path.posix.join(path.posix.sep, 'fixture-home', 'project'), empty: true, git: false }),
    });
    const ticket = await verification.verify(input, new AbortController().signal);
    blockedAt = calls + (phase === '创建开始' ? 1 : 3);
    const controller = new AbortController();
    let rejected = false;
    const creation = verification
      .create({ input, verification: ticket.verification, initializationConfirmed: true }, controller.signal)
      .catch(() => {
        rejected = true;
      });
    try {
      await blocked;
      controller.abort(new Error('已取消本次创建'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(rejected).toBe(true);
      expect(await store.list()).toEqual([]);
      expect(sync.initialize).not.toHaveBeenCalled();
    } finally {
      release();
      await creation;
      verification.dispose();
    }
  });
});
