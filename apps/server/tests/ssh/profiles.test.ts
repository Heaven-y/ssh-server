import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerTargets } from '../../src/ssh/targets';
import { createServerProfiles } from '../../src/ssh/profiles';
import { createWorkspaceStore } from '../../src/workspaces/store';
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
  const state = { connected: true, hasPassword: true, saved: false, savingAvailable: false, paused: false };
  const pool = {
    disconnect: vi.fn(),
    forgetServerCredentials: vi.fn(async (_server: unknown) => undefined),
    generation: () => 1,
    credentialStatus: vi.fn(async () => state),
    connect: vi.fn(async () => ({ ...state, connected: true as const, authMode: 'password' as const })),
    clearSavedPassword: vi.fn(async () => ({ ...state, connected: false, hasPassword: false, paused: true })),
    readServerPassword: vi.fn(async () => ({ password: null, revision: 'a'.repeat(64), savingAvailable: false })),
    commitServerEdit: vi.fn(async () => undefined),
  };
  const profiles = createServerProfiles({ targets, store, pool });
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
    dir: root,
    remoteDir: '~/projects/demo',
    server: server.alias,
  });
  return { root, targets, profiles, store, pool, server, workspace, app };
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
  it('工作区活动不再阻断连接与凭据操作；普通连接检查与非普通连接均放行', async () => {
    const f = await fixture();
    await f.store.create({
      name: '另一个项目',
      dir: f.root,
      remoteDir: '/other',
      server: f.server.alias,
    });
    const request = (password?: string) =>
      f.app.inject({ method: 'POST', url: '/api/ssh/connect', payload: { sshHost: f.server.alias, password } });
    expect((await request()).statusCode).toBe(200);
    expect((await request('fixture-secret')).statusCode).toBe(200);
    expect(f.pool.connect).toHaveBeenCalledTimes(2);
    expect(f.pool.disconnect).not.toHaveBeenCalled();
  });
});

it('删除与创建竞争时持有工作区快照，排队创建不能引用已删除服务器', async () => {
  const f = await fixture();
  await f.store.remove(f.workspace.id);
  const { id: _id, ...input } = f.workspace;
  const deletion = f.profiles.remove(f.server.alias, f.server);
  const creation = f.store.create(input);
  await expect(creation).rejects.toMatchObject({ field: 'server' });
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
