import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { Workspace } from '@ssh-server/shared';
import { createSessionRegistry } from '../chat/registry';
import type { ExecResult } from '../ssh/exec';
import { registerInternalRoutes } from './internal.routes';

const ws: Workspace = { id: 'w1', name: 'demo', localDir: 'D:/w', sshHost: 'my-server', remoteDir: '~/projects/demo' };
const okResult: ExecResult = {
  stdout: 'h1\n',
  stderr: '',
  exitCode: 0,
  timedOut: false,
  truncated: false,
  durationMs: 3,
};

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function setup(opts: { workspace?: Workspace; fail?: boolean } = {}) {
  const calls: Array<{ alias: string; cmd: string; localTimeoutMs: number }> = [];
  const registry = createSessionRegistry();
  const token = registry.register('w1');
  const app = Fastify();
  apps.push(app);
  registerInternalRoutes(app, {
    registry,
    getWorkspace: async (id) => (id === 'w1' ? (opts.workspace ?? ws) : undefined),
    pool: {
      exec: async (alias, cmd, o) => {
        calls.push({ alias, cmd, localTimeoutMs: o.localTimeoutMs });
        if (opts.fail) throw new Error('SSH 连接 my-server 失败：超时');
        return okResult;
      },
    },
  });
  /** auth 为 null 表示不带 Authorization 头 */
  const post = (url: string, payload: unknown, auth: string | null = `Bearer ${token}`) =>
    app.inject({ method: 'POST', url, payload: payload as object, headers: auth ? { authorization: auth } : {} });
  return { calls, post };
}

describe('POST /internal/remote-exec', () => {
  it('没有或令牌未知时 401', async () => {
    const { post } = setup();
    expect((await post('/internal/remote-exec', { command: 'ls' }, null)).statusCode).toBe(401);
    expect((await post('/internal/remote-exec', { command: 'ls' }, 'Bearer nope')).statusCode).toBe(401);
  });

  it('命中黑名单时拒绝，且不调用 SSH', async () => {
    const { post, calls } = setup();
    const r = await post('/internal/remote-exec', { command: 'sudo ls' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ denied: { ruleId: 'privilege' } });
    expect(calls).toHaveLength(0);
  });

  it('正常命令在服务器目录下执行，默认超时 600 秒加 30 秒宽限', async () => {
    const { post, calls } = setup();
    const r = await post('/internal/remote-exec', { command: 'hostname' });
    expect(r.json()).toMatchObject({ stdout: 'h1\n', exitCode: 0 });
    expect(calls[0]!.alias).toBe('my-server');
    expect(calls[0]!.cmd.startsWith('cd ')).toBe(true);
    expect(calls[0]!.cmd).toContain("bash -lc 'hostname'");
    expect(calls[0]!.localTimeoutMs).toBe((600 + 30) * 1000);
  });

  it('超时上限为 3600 秒', async () => {
    const { post, calls } = setup();
    await post('/internal/remote-exec', { command: 'ls', timeoutSec: 99999 });
    expect(calls[0]!.cmd).toContain('timeout 3600 ');
  });

  it('工作区停用规则后放行', async () => {
    const { post, calls } = setup({ workspace: { ...ws, policy: { disabledRules: ['privilege'] } } });
    const r = await post('/internal/remote-exec', { command: 'sudo ls' });
    expect(r.json()).toMatchObject({ exitCode: 0 });
    expect(calls).toHaveLength(1);
  });

  it('SSH 出错时返回 error 字段', async () => {
    const { post } = setup({ fail: true });
    const r = await post('/internal/remote-exec', { command: 'ls' });
    expect(r.json()).toMatchObject({ error: expect.stringContaining('SSH 连接') });
  });

  it('缺少 command 时 400', async () => {
    const { post } = setup();
    expect((await post('/internal/remote-exec', {})).statusCode).toBe(400);
  });
});

describe('POST /internal/remote-peek', () => {
  it('行数超过 200 时 400', async () => {
    const { post } = setup();
    expect((await post('/internal/remote-peek', { path: 'a.txt', action: 'head', lines: 500 })).statusCode).toBe(400);
  });

  it('拼装查看命令并执行', async () => {
    const { post, calls } = setup();
    const r = await post('/internal/remote-peek', { path: 'logs/a.txt', action: 'head', lines: 20 });
    expect(r.statusCode).toBe(200);
    expect(calls[0]!.cmd).toContain("head -n 20 -- 'logs/a.txt'");
  });
});
