import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SshConnectionError } from '../ssh/connection';
import type { SshPool } from '../ssh/pool';
import { registerSshRoutes } from './ssh.routes';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function setup() {
  const app = Fastify();
  apps.push(app);
  const pool = {
    setPassword: vi.fn<SshPool['setPassword']>(async () => undefined),
    disconnect: vi.fn(),
    generation: vi.fn(() => 0),
    exec: vi.fn<SshPool['exec']>(async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      truncated: false,
      durationMs: 1,
    })),
  };
  registerSshRoutes(app, { pool });
  const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });
  return { pool, post };
}
const input = { sshHost: 'my-server', authMode: 'password', remoteDir: '~/projects/demo' };
describe('SSH 连接与断开接口', () => {
  it('参数非法时不尝试连接', async () => {
    const { post, pool } = setup();
    expect((await post('/api/ssh/connect', { ...input, authMode: 'auto' })).statusCode).toBe(400);
    expect((await post('/api/ssh/connect', { ...input, remoteDir: 'relative' })).statusCode).toBe(400);
    expect(pool.exec).not.toHaveBeenCalled();
  });
  it('密码交给内存池，响应不含凭据；连接测试限制在指定目录', async () => {
    const { post, pool } = setup();
    const result = await post('/api/ssh/connect', { ...input, password: 'fixture-secret' });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ connected: true, authMode: 'password' });
    expect(result.body).not.toContain('fixture-secret');
    expect(pool.setPassword).toHaveBeenCalledWith('my-server', 'fixture-secret');
    expect(pool.exec).toHaveBeenCalledWith(
      { alias: 'my-server', authMode: 'password' },
      expect.stringContaining('test -d .'),
      expect.any(Object),
    );
    expect(pool.exec.mock.calls[0]?.[1]).toContain('projects/demo');
  });
  it('私钥方式不接受多余密码，也不回退或存入密码 vault', async () => {
    const { post, pool } = setup();
    expect((await post('/api/ssh/connect', { ...input, authMode: 'key', password: 'unused-secret' })).statusCode).toBe(
      400,
    );
    expect(pool.setPassword).not.toHaveBeenCalled();
  });
  it('密码缺省时使用已有认证周期，断开调用清除接口', async () => {
    const { post, pool } = setup();
    expect((await post('/api/ssh/connect', input)).statusCode).toBe(200);
    expect(pool.setPassword).not.toHaveBeenCalled();
    expect((await post('/api/ssh/disconnect', { sshHost: 'my-server' })).statusCode).toBe(204);
    expect(pool.disconnect).toHaveBeenCalledWith('my-server');
  });
  it('已分类 SSH 错误只返回安全信息，失败清除临时密码', async () => {
    const { post, pool } = setup();
    pool.exec.mockRejectedValueOnce(new SshConnectionError('authentication_failed', 'SSH 认证失败'));
    const result = await post('/api/ssh/connect', { ...input, password: 'fixture-secret' });
    expect(result.statusCode).toBe(409);
    expect(result.json()).toEqual({ code: 'authentication_failed', message: 'SSH 认证失败' });
    expect(pool.disconnect).toHaveBeenCalledWith('my-server', 0);
  });
  it('目录不可用与底层错误不泄露内部信息', async () => {
    const { post, pool } = setup();
    pool.exec.mockResolvedValueOnce({
      stdout: '',
      stderr: 'private-data',
      exitCode: 1,
      timedOut: false,
      truncated: false,
      durationMs: 1,
    });
    expect((await post('/api/ssh/connect', input)).json()).toMatchObject({ code: 'remote_directory_unavailable' });
    pool.exec.mockRejectedValueOnce(new Error('private-secret-and-config'));
    const result = await post('/api/ssh/connect', input);
    expect(result.statusCode).toBe(502);
    expect(result.body).not.toContain('private-secret');
  });
  it('旧连接测试迟到失败不清除新请求的认证周期', async () => {
    const { post, pool } = setup();
    let generation = 0;
    pool.generation.mockImplementation(() => generation);
    pool.setPassword.mockImplementation(() => {
      generation += 1;
      return Promise.resolve();
    });
    let rejectOld!: (error: Error) => void;
    pool.exec.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    const old = post('/api/ssh/connect', { ...input, password: 'old-secret' });
    await vi.waitFor(() => expect(pool.exec).toHaveBeenCalledTimes(1));
    expect((await post('/api/ssh/connect', { ...input, password: 'new-secret' })).statusCode).toBe(200);
    rejectOld(new SshConnectionError('connection_cancelled', '旧认证周期已结束'));
    expect((await old).statusCode).toBe(409);
    expect(pool.disconnect).toHaveBeenCalledWith('my-server', 1);
  });
  it.each(['line\nsecond', 'line\rsecond', 'nul\0byte'])('密码中控制分隔符被拒绝', async (password) => {
    const { post, pool } = setup();
    expect((await post('/api/ssh/connect', { ...input, password })).statusCode).toBe(400);
    expect(pool.setPassword).not.toHaveBeenCalled();
  });
});
