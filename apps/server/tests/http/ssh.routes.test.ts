import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SshConnectionError } from '../../src/ssh/connection';
import { CredentialStorageError } from '../../src/ssh/credential-storage-error';
import type { SshPool } from '../../src/ssh/pool';
import { registerSshRoutes } from '../../src/http/ssh.routes';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function setup() {
  const app = Fastify();
  apps.push(app);
  const state = { saved: false, savingAvailable: true, paused: false, connected: false, hasPassword: false };
  const pool = {
    connect: vi.fn<SshPool['connect']>(async () => ({
      ...state,
      connected: true,
      hasPassword: true,
      authMode: 'password',
    })),
    credentialStatus: vi.fn<SshPool['credentialStatus']>(async () => state),
    clearSavedPassword: vi.fn<SshPool['clearSavedPassword']>(async () => ({ ...state, paused: true })),
    disconnect: vi.fn(),
    generation: vi.fn(() => 0),
  };
  registerSshRoutes(app, { pool, profiles: { connection: async (_alias, _changing, operation) => operation() } });
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
  return { app, pool, post };
}
const input = { sshHost: 'my-server' };
describe('SSH 连接与保存状态接口', () => {
  it('非法认证模式、目录、保存选项与私钥附带密码不进入连接流程', async () => {
    const { post, pool } = setup();
    for (const extra of [
      { authMode: 'auto' },
      { remoteDir: 'relative' },
      { savePassword: 'yes' },
      { authMode: 'key', password: 'unused-secret' },
    ]) {
      expect((await post('/api/ssh/connect', { ...input, ...extra })).statusCode).toBe(400);
    }
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('连接仅返回认证与保存状态，禁止缓存且不回传密码', async () => {
    const { post, pool } = setup();
    const result = await post('/api/ssh/connect', { ...input, password: 'fixture-secret', savePassword: true });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({
      connected: true,
      hasPassword: true,
      authMode: 'password',
      saved: false,
      savingAvailable: true,
      paused: false,
    });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).not.toContain('fixture-secret');
    expect(pool.connect).toHaveBeenCalledWith({ ...input, password: 'fixture-secret', savePassword: true });
    expect((await post('/api/ssh/disconnect', { sshHost: 'my-server' })).statusCode).toBe(204);
    expect(pool.disconnect).toHaveBeenCalledWith('my-server');
  });
  it('状态查询和取消保存不提供密码，取消接口只接受 false', async () => {
    const { app } = setup();
    const status = await app.inject({ url: '/api/ssh/credentials?sshHost=my-server' });
    expect(status.json()).toEqual({
      saved: false,
      savingAvailable: true,
      paused: false,
      connected: false,
      hasPassword: false,
    });
    expect(status.headers['cache-control']).toBe('no-store');
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/ssh/credentials',
          payload: { sshHost: 'my-server', savePassword: false },
        })
      ).json(),
    ).toMatchObject({ saved: false, paused: true });
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/ssh/credentials',
          payload: { sshHost: 'my-server', savePassword: true },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('SSH 与保存错误只返回分类消息，未知内部错误匿名', async () => {
    const { post, pool } = setup();
    pool.connect.mockRejectedValueOnce(new SshConnectionError('authentication_failed', 'SSH 认证失败'));
    expect((await post('/api/ssh/connect', input)).json()).toEqual({
      code: 'authentication_failed',
      message: 'SSH 认证失败',
    });
    pool.connect.mockRejectedValueOnce(new CredentialStorageError('credential_storage_failed', '本机加密失败'));
    expect((await post('/api/ssh/connect', input)).json()).toEqual({
      code: 'credential_storage_failed',
      message: '本机加密失败',
    });
    pool.connect.mockRejectedValueOnce(new SshConnectionError('remote_directory_unavailable', '目录不可用'));
    expect((await post('/api/ssh/connect', input)).statusCode).toBe(502);
    pool.connect.mockRejectedValueOnce(new Error('private-secret-and-config'));
    const result = await post('/api/ssh/connect', input);
    expect(result.statusCode).toBe(502);
    expect(result.body).not.toContain('private-secret');
  });
  it.each(['line\nsecond', 'line\rsecond', 'nul\0byte'])('密码中控制分隔符被拒绝', async (password) => {
    const { post, pool } = setup();
    expect((await post('/api/ssh/connect', { ...input, password })).statusCode).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('取消普通复用检查不会断开已有共享连接', async () => {
  const { app, pool } = setup();
  pool.credentialStatus.mockResolvedValue({
    saved: true,
    savingAvailable: true,
    paused: false,
    connected: true,
    hasPassword: true,
  });
  const started = deferred<void>();
  const closed = deferred<void>();
  const pending = deferred<Awaited<ReturnType<SshPool['connect']>>>();
  pool.connect.mockImplementationOnce(() => {
    started.resolve();
    return pending.promise;
  });
  app.addHook('onRequest', (_req, reply, done) => {
    reply.raw.once('close', () => closed.resolve());
    done();
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as { port: number }).port;
  const controller = new AbortController();
  const request = fetch(`http://127.0.0.1:${port}/api/ssh/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: controller.signal,
  }).catch(() => undefined);
  await started.promise;
  controller.abort();
  await closed.promise;
  expect(pool.disconnect).not.toHaveBeenCalled();
  pending.resolve({
    saved: true,
    savingAvailable: true,
    paused: false,
    connected: true,
    hasPassword: true,
    authMode: 'password',
  });
  await request;
});
