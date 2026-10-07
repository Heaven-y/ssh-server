import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncSettingsSchema } from '@ssh-server/shared';
import type { SshPool } from '../../src/ssh/pool';
import { createWorkspaceStore } from '../../src/workspaces/store';
import { createSetupVerification } from '../../src/workspaces/setup/verification';
import { createLocalDirectoryBrowser } from '../../src/workspaces/setup/local';
import { previewWorkspace } from '../../src/workspaces/setup/preview';
import { localInventory } from '../../src/sync/inventory';
import { startSetupFixture } from '../../../../scripts/dev/setup-fixture';
import { createSshPool } from '../../src/ssh/pool';
import { createPasswordStore } from '../../src/ssh/password-store';
import { serverHostConfig } from '../../src/ssh/targets';
import { createSetupRemote } from '../../src/workspaces/setup/remote';

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(closers.splice(0).map((close) => close()));
});
async function temporary() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workspace-setup-test-'));
  closers.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function verificationFixture() {
  const root = await temporary();
  const localDir = path.join(root, 'project');
  await mkdir(localDir);
  const state = { generation: 1, key: 'original' };
  const pool = {
    generation: () => state.generation,
    resolveConnection: () => Promise.resolve({ cacheKey: state.key, authMode: 'password' }),
  } as unknown as SshPool;
  const store = createWorkspaceStore({
    configDir: path.join(root, 'config'),
    knownHosts: () => Promise.resolve(['my-server']),
    dirExists: () => Promise.resolve(true),
  });
  const input = { name: '演示', localDir, sshHost: 'my-server', remoteDir: '~/projects/demo' };
  const sync = {
    initialize: vi.fn(() => Promise.reject(new Error('合成初始化错误'))),
    status: () =>
      Promise.resolve({
        phase: 'uninitialized' as const,
        settings: SyncSettingsSchema.parse({}),
        deletions: [],
        conflicts: [],
      }),
  };
  const service = createSetupVerification({
    pool,
    store,
    sync,
    inspectRemote: () =>
      Promise.resolve({ path: path.posix.join(path.posix.sep, 'fixture-home', 'project'), empty: true, git: false }),
  });
  closers.push(async () => service.dispose());
  return { state, store, input, sync, service };
}
describe('创建验证与只读草稿的核心契约', () => {
  it.skipIf(process.platform !== 'win32')(
    '手动目标的Windows密文经新后端实例复用，并贯通草稿目录',
    async () => {
      const f = await startSetupFixture();
      closers.push(() => f.close());
      const target = await f.targets.save({
        name: '手动演示',
        hostname: '127.0.0.1',
        port: f.ssh.port,
        username: 'demo',
        authMode: 'password',
      });
      const checked = await f.trust.probe(target.alias, new AbortController().signal);
      await f.trust.confirm(
        { challenge: checked.challenge!, fingerprint: checked.fingerprint, confirmed: true },
        new AbortController().signal,
      );
      const input = { sshHost: target.alias };
      expect(await f.pool.connect({ ...input, password: 'fixture-secret', savePassword: true })).toMatchObject({
        connected: true,
        saved: true,
      });
      f.pool.dispose();
      const restarted = createSshPool({
        homeDir: f.homeDir,
        passwordStore: createPasswordStore({ configDir: f.configDir }),
        lookupHost: async (alias) => {
          const saved = await f.targets.get(alias);
          return saved ? serverHostConfig(saved) : undefined;
        },
      });
      const browser = createSetupRemote(restarted);
      try {
        expect(await restarted.connect(input)).toMatchObject({ connected: true, saved: true });
        const session = await browser.open({ ...input, remoteDir: f.ssh.root }, new AbortController().signal);
        expect(
          (await browser.list(session.id, { path: f.ssh.root }, new AbortController().signal)).entries.length,
        ).toBeGreaterThan(0);
        browser.close(session.id);
        const names = await readdir(path.join(f.configDir, 'credentials'));
        for (const name of names)
          expect(await readFile(path.join(f.configDir, 'credentials', name), 'utf8')).not.toContain('fixture-secret');
      } finally {
        browser.dispose();
        restarted.dispose();
      }
    },
    20000,
  );
  it.each(['快照', '代次', '配置', '目录', '撤销', '过期'] as const)('%s变化后不能保存，票不能重放', async (change) => {
    const f = await verificationFixture();
    const ticket = await f.service.verify(f.input, new AbortController().signal);
    if (change === '快照') f.input.name = '改变名称';
    if (change === '代次') f.state.generation++;
    if (change === '配置') f.state.key = 'changed';
    if (change === '目录') {
      await rename(f.input.localDir, `${f.input.localDir}-previous`);
      await mkdir(f.input.localDir);
    }
    if (change === '撤销') f.service.revoke(ticket.verification);
    if (change === '过期') vi.spyOn(Date, 'now').mockReturnValue(ticket.expiresAt + 1);
    const request = { input: f.input, verification: ticket.verification, initializationConfirmed: true as const };
    await expect(f.service.create(request, new AbortController().signal)).rejects.toMatchObject({
      code: ['撤销', '过期'].includes(change) ? 'setup_verification_expired' : 'setup_verification_changed',
    });
    await expect(f.service.create(request, new AbortController().signal)).rejects.toMatchObject({
      code: 'setup_verification_expired',
    });
    expect(await f.store.list()).toEqual([]);
    expect(f.sync.initialize).not.toHaveBeenCalled();
  });
  it('初始化抛错保留配置且并发重放只创建一次', async () => {
    const f = await verificationFixture();
    const ticket = await f.service.verify(f.input, new AbortController().signal);
    const request = { input: f.input, verification: ticket.verification, initializationConfirmed: true as const };
    const results = await Promise.allSettled([
      f.service.create(request, new AbortController().signal),
      f.service.create(request, new AbortController().signal),
    ]);
    const success = results.find((result) => result.status === 'fulfilled');
    expect(success?.status === 'fulfilled' && success.value.sync.phase).toBe('error');
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await f.store.list()).toHaveLength(1);
    expect(f.sync.initialize).toHaveBeenCalledTimes(1);
  });
  it('本地200项分页不读取正文，游标一次消费且显式关闭后失效', async () => {
    const root = await temporary();
    await Promise.all(Array.from({ length: 202 }, (_, i) => writeFile(path.join(root, `sample-${i}.py`), 'fixture')));
    const browser = createLocalDirectoryBrowser();
    closers.push(() => browser.dispose());
    const first = await browser.list({ path: root }, new AbortController().signal);
    expect(first.entries).toHaveLength(200);
    expect(first.nextCursor).toBeTruthy();
    const second = await browser.list({ path: root, cursor: first.nextCursor }, new AbortController().signal);
    expect(second.entries).toHaveLength(2);
    expect(second.nextCursor).toBeUndefined();
    const reopened = await browser.list({ path: root }, new AbortController().signal);
    await browser.close(reopened.nextCursor!);
    await expect(
      browser.list({ path: root, cursor: reopened.nextCursor }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'local_cursor_expired' });
  });
  it('预览两端过滤、不读.git、不创建同步基线；取消和遍历上限拒绝部分统计', async () => {
    const root = await temporary();
    await mkdir(path.join(root, '.git'));
    await writeFile(path.join(root, '.git', 'private'), 'ignored');
    await writeFile(path.join(root, 'train.py'), 'hello');
    await writeFile(path.join(root, 'weights.pt'), 'excluded');
    const result = await previewWorkspace(
      {
        configDir: root,
        pool: {} as SshPool,
        remoteMetadata: () =>
          Promise.resolve([
            { path: 'code.py', size: 10, modTime: '2026-10-05T00:00:00Z' },
            { path: 'weights.pt', size: 20, modTime: '2026-10-05T00:00:00Z' },
          ]),
      },
      { name: '演示', localDir: root, sshHost: 'my-server', remoteDir: '~/projects/demo' },
      new AbortController().signal,
    );
    expect(result.local).toMatchObject({
      included: { files: 1, bytes: 5 },
      excluded: { files: 1, bytes: 8, examples: ['weights.pt'] },
    });
    expect(result.remote).toMatchObject({ included: { files: 1, bytes: 10 }, excluded: { files: 1, bytes: 20 } });
    expect((await readdir(root)).sort()).toEqual(['.git', 'train.py', 'weights.pt']);
    await expect(localInventory(root, SyncSettingsSchema.parse({}), { maxEntries: 1 })).rejects.toMatchObject({
      code: 'inventory_limit',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(localInventory(root, SyncSettingsSchema.parse({}), { signal: controller.signal })).rejects.toThrow();
  });
  it('真实无认证指纹、草稿SFTP分页关闭与生产HTTP票据不可绕过', async () => {
    const f = await startSetupFixture();
    closers.push(() => f.close());
    const server = await f.targets.save({
      name: '演示',
      hostname: '127.0.0.1',
      port: f.ssh.port,
      username: 'demo',
      authMode: 'password',
    });
    const checked = await f.trust.probe(server.alias, new AbortController().signal);
    expect(f.ssh.audit.authentications).toBe(0);
    await f.trust.confirm(
      { challenge: checked.challenge!, fingerprint: checked.fingerprint, confirmed: true },
      new AbortController().signal,
    );
    expect(f.ssh.audit.authentications).toBe(0);
    await f.pool.setPassword(server.alias, 'fixture-secret');
    const session = await f.setup.openRemote({ sshHost: server.alias, remoteDir: '~' }, new AbortController().signal);
    const page = await f.setup.readRemote(
      session.id,
      { path: path.posix.join(path.posix.sep, 'fixture-home', 'datasets') },
      new AbortController().signal,
    );
    expect(page.entries).toHaveLength(200);
    f.setup.closeRemote(session.id);
    const generation = f.pool.generation(server.alias);
    const otherDirectory = await f.setup.openRemote(
      { sshHost: server.alias, remoteDir: f.ssh.root },
      new AbortController().signal,
    );
    expect(f.ssh.audit.authentications).toBe(1);
    expect(f.pool.generation(server.alias)).toBe(generation);
    f.setup.closeRemote(otherDirectory.id);
    await expect(
      f.setup.readRemote(session.id, { path: session.root }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'setup_session_expired' });
    expect(f.ssh.audit.bodyReads).toBe(0);
    const login = await f.app.inject({
      method: 'POST',
      url: '/api/local-session',
      payload: {},
      headers: { host: new URL(f.url).host, origin: new URL(f.url).origin },
    });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const headers = { cookie, host: new URL(f.url).host, origin: new URL(f.url).origin };
    const input = {
      name: 'HTTP演示',
      localDir: f.localDir,
      sshHost: server.alias,
      remoteDir: f.ssh.root,
    };
    const rejected = await f.app.inject({ method: 'POST', url: '/api/workspaces', payload: input, headers });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ code: 'setup_verification_required' });
    const ticket = await f.app.inject({ method: 'POST', url: '/api/workspace-setup/verify', payload: input, headers });
    expect(ticket.statusCode).toBe(200);
    f.state.initializationFailure = true;
    const created = await f.app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        input,
        verification: ticket.json<{ verification: string }>().verification,
        initializationConfirmed: true,
      },
      headers,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ sync: { phase: 'error' } });
    expect(await f.store.list()).toHaveLength(1);
    expect(f.state.initializations).toBe(1);
  });
});
