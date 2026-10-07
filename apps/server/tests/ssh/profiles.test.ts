import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRemovalBlocker } from '@ssh-server/shared';
import { createServerTargets } from '../../src/ssh/targets';
import { createServerProfiles } from '../../src/ssh/profiles';
import { createWorkspaceStore } from '../../src/workspaces/store';
import { createWorkspaceActivity } from '../../src/workspaces/activity';
import { registerSshTargetRoutes } from '../../src/http/ssh-targets.routes';
import { registerSshRoutes } from '../../src/http/ssh.routes';

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});
const input = { name: '演示', hostname: 'example.invalid', username: 'demo', authMode: 'password' as const, port: 22 };
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'profiles-test-'));
  const targets = createServerTargets({ configDir: root, homeDir: root });
  const store = createWorkspaceStore({
    configDir: root,
    dirExists: async () => true,
    knownHosts: async () => (await targets.list()).map((server) => server.alias),
  });
  const activity = createWorkspaceActivity();
  const resources = { blockers: vi.fn<(id: string) => Promise<WorkspaceRemovalBlocker[]>>(async () => []) };
  const state = { connected: true, hasPassword: true, saved: false, savingAvailable: false, paused: false };
  const pool = {
    disconnect: vi.fn(),
    forgetServerCredentials: vi.fn(async (_server: unknown) => undefined),
    generation: () => 1,
    credentialStatus: vi.fn(async () => state),
    connect: vi.fn(async () => ({ ...state, connected: true as const, authMode: 'password' as const })),
    clearSavedPassword: vi.fn(async () => ({ ...state, connected: false, hasPassword: false, paused: true })),
  };
  const profiles = createServerProfiles({ targets, store, activity, resources, pool });
  const app = Fastify();
  registerSshTargetRoutes(app, profiles);
  registerSshRoutes(app, { profiles, pool });
  closers.push(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const server = await targets.save(input);
  const workspace = await store.create({
    name: '项目',
    localDir: root,
    remoteDir: '~/projects/demo',
    sshHost: server.alias,
  });
  return { root, targets, profiles, activity, store, pool, server, workspace, app, resources };
}
describe('服务器档案事务及HTTP保护', () => {
  it('GET只列登记档案，导入选项保留unsupported和私钥路径且不改写config', async () => {
    const f = await fixture();
    await mkdir(path.join(f.root, '.ssh'));
    const file = path.join(f.root, '.ssh', 'config');
    const text = 'Host import-only\n HostName import.invalid\n User demo\n IdentityFile ~/.ssh/demo\n ProxyJump jump\n';
    await writeFile(file, text, 'utf8');
    expect((await f.app.inject({ url: '/api/ssh-targets' })).json()).toEqual([f.server]);
    expect((await f.app.inject({ url: '/api/ssh-targets/import-options' })).json()).toMatchObject([
      { alias: 'import-only', keyFile: path.join(f.root, '.ssh', 'demo'), unsupported: ['ProxyJump'] },
    ]);
    expect(await readFile(file, 'utf8')).toBe(text);
  });
  it('被引用的目标和删除拒绝；空闲认证变更失效连接，旧快照409', async () => {
    const f = await fixture();
    const url = '/api/ssh-targets/' + f.server.alias;
    for (const patch of [
      { hostname: 'other.invalid' },
      { username: 'other' },
      { port: 2222 },
      { authMode: 'key', keyFile: path.join(f.root, 'key') },
    ]) {
      const response = await f.app.inject({
        method: 'PUT',
        url,
        payload: { input: { ...input, ...patch }, expected: f.server },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'target_referenced' });
    }
    expect(
      (await f.app.inject({ method: 'DELETE', url, payload: { expected: f.server, confirmed: true } })).statusCode,
    ).toBe(409);
    expect(f.pool.disconnect).not.toHaveBeenCalled();
    const next = await f.app.inject({
      method: 'PUT',
      url,
      payload: { input: { ...input, authMode: 'key' }, expected: f.server },
    });
    expect(next.statusCode).toBe(200);
    expect(next.json()).toMatchObject({ alias: f.server.alias, authMode: 'key' });
    expect(f.pool.disconnect).toHaveBeenCalledWith(f.server.alias);
    expect((await f.app.inject({ method: 'PUT', url, payload: { input, expected: f.server } })).statusCode).toBe(409);
  });
  it('无引用删除要求完整expected和确认，不静默覆盖档案', async () => {
    const f = await fixture();
    await f.store.remove(f.workspace.id);
    const url = '/api/ssh-targets/' + f.server.alias;
    expect((await f.app.inject({ method: 'DELETE', url, payload: { expected: f.server } })).statusCode).toBe(400);
    expect(
      (await f.app.inject({ method: 'DELETE', url, payload: { expected: f.server, confirmed: true } })).statusCode,
    ).toBe(204);
    expect(await f.targets.list()).toEqual([]);
    expect(f.pool.forgetServerCredentials).toHaveBeenCalledExactlyOnceWith(f.server);
  });
  it('另一关联工作区活动、持久任务和同步收尾均阻断修改和断开', async () => {
    const f = await fixture();
    const other = await f.store.create({
      name: '另一个项目',
      localDir: f.root,
      remoteDir: '/other',
      sshHost: f.server.alias,
    });
    const release = f.activity.acquire(other.id);
    await expect(f.profiles.update(f.server.alias, { ...input, authMode: 'key' }, f.server)).rejects.toMatchObject({
      code: 'target_busy',
    });
    const disconnect = () =>
      f.app.inject({ method: 'POST', url: '/api/ssh/disconnect', payload: { sshHost: f.server.alias } });
    expect((await disconnect()).statusCode).toBe(409);
    release();
    for (const code of ['sync_busy', 'sync_task_pending'] as const) {
      f.resources.blockers.mockResolvedValue([{ code, message: '未完成' }]);
      expect((await disconnect()).statusCode).toBe(409);
      await expect(f.profiles.update(f.server.alias, { ...input, authMode: 'key' }, f.server)).rejects.toMatchObject({
        code: 'target_busy',
      });
    }
    expect(f.pool.disconnect).not.toHaveBeenCalled();
  });
  it('普通连接检查不中断活动工作区；新密码被拒绝', async () => {
    const f = await fixture();
    const release = f.activity.acquire(f.workspace.id);
    try {
      const request = (password?: string) =>
        f.app.inject({ method: 'POST', url: '/api/ssh/connect', payload: { sshHost: f.server.alias, password } });
      expect((await request()).statusCode).toBe(200);
      expect((await request('fixture-secret')).statusCode).toBe(409);
      expect(f.pool.connect).toHaveBeenCalledTimes(1);
      expect(f.pool.disconnect).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });
  it('写盘前再次检查任务，锁内不允许新活动和并发工作区换绑', async () => {
    const f = await fixture();
    f.resources.blockers
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(async (id) => {
        expect(() => f.activity.acquire(id)).toThrow();
        return [{ code: 'sync_task_pending', message: '收尾未完成' }];
      });
    await expect(f.profiles.update(f.server.alias, { ...input, authMode: 'key' }, f.server)).rejects.toMatchObject({
      code: 'target_busy',
    });
    expect(await f.targets.get(f.server.alias)).toEqual(f.server);
    expect(f.pool.disconnect).not.toHaveBeenCalled();
  });
});

it('删除与创建竞争时持有工作区快照，排队创建不能引用已删除服务器', async () => {
  const f = await fixture();
  await f.store.remove(f.workspace.id);
  const { id: _id, ...input } = f.workspace;
  const deletion = f.profiles.remove(f.server.alias, f.server);
  const creation = f.store.create(input);
  await expect(creation).rejects.toMatchObject({ field: 'sshHost' });
  await deletion;
  expect(await f.store.list()).toEqual([]);
  expect(await f.targets.list()).toEqual([]);
});

it('HTTP expected按原始完整记录比较，不用默认值或规范化补齐快照', async () => {
  const f = await fixture();
  const { port: _port, ...incomplete } = f.server;
  for (const expected of [incomplete, { ...f.server, hostname: 'EXAMPLE.INVALID' }]) {
    const response = await f.app.inject({
      method: 'PUT',
      url: '/api/ssh-targets/' + f.server.alias,
      payload: { input, expected },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'target_changed' });
  }
  expect(await f.targets.get(f.server.alias)).toEqual(f.server);
  expect(f.pool.disconnect).not.toHaveBeenCalled();
});

it('删除时凭据清理失败保留档案；陈旧快照不触碰凭据', async () => {
  const f = await fixture();
  await f.store.remove(f.workspace.id);
  f.pool.forgetServerCredentials.mockRejectedValueOnce(new Error('清理失败'));
  await expect(f.profiles.remove(f.server.alias, f.server)).rejects.toThrow('清理失败');
  expect(await f.targets.get(f.server.alias)).toEqual(f.server);
  await expect(f.profiles.remove(f.server.alias, { ...f.server, name: '陈旧' })).rejects.toMatchObject({
    code: 'target_changed',
  });
  expect(f.pool.forgetServerCredentials).toHaveBeenCalledTimes(1);
});
