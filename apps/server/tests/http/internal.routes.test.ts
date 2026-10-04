import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncSettingsSchema, type SyncStatus, type Workspace } from '@ssh-server/shared';
import { createSessionRegistry } from '../../src/chat/registry';
import type { ExecResult } from '../../src/ssh/exec';
import type { SshTarget } from '../../src/ssh/connection';
import { SyncError } from '../../src/sync/errors';
import type { SyncManager } from '../../src/sync/manager';
import { registerInternalRoutes } from '../../src/http/internal.routes';

const ws: Workspace = {
  id: 'w1',
  name: 'demo',
  localDir: path.join(os.tmpdir(), 'ssh-server-fixture', 'demo'),
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
};
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

function setup(opts: { workspace?: Workspace; fail?: boolean; syncFail?: boolean; postFail?: boolean } = {}) {
  const calls: Array<{ alias: SshTarget; cmd: string; localTimeoutMs: number }> = [];
  const registry = createSessionRegistry();
  const token = registry.register('w1');
  const app = Fastify();
  apps.push(app);
  const status: SyncStatus = {
    phase: opts.postFail ? 'error' : 'ready',
    deletions: [],
    conflicts: [],
    settings: SyncSettingsSchema.parse({}),
  };
  const execute: SyncManager['execute'] = async (_ws, command) => {
    if (opts.syncFail) throw new SyncError('sync_blocked', '同步未就绪，命令未执行');
    return { ...(await command()), sync: status };
  };
  const sync = { execute: vi.fn(execute) as SyncManager['execute'], sync: vi.fn(async () => status) };
  registerInternalRoutes(app, {
    registry,
    getWorkspace: async (id) => (id === 'w1' ? (opts.workspace ?? ws) : undefined),
    sync,
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
  return { calls, post, sync };
}

describe('POST /internal/remote-exec', () => {
  it('没有或令牌未知时 401', async () => {
    const { post } = setup();
    expect((await post('/internal/remote-exec', { command: 'ls' }, null)).statusCode).toBe(401);
    expect((await post('/internal/remote-exec', { command: 'ls' }, 'Bearer nope')).statusCode).toBe(401);
  });

  it('命中黑名单时拒绝，且不调用 SSH', async () => {
    const { post, calls, sync } = setup();
    const r = await post('/internal/remote-exec', { command: 'sudo ls' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ denied: { ruleId: 'privilege' } });
    expect(calls).toHaveLength(0);
    expect(sync.execute).not.toHaveBeenCalled();
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

  it('密码工作区向执行层传递认证方式', async () => {
    const { post, calls } = setup({ workspace: { ...ws, authMode: 'password' } });
    await post('/internal/remote-exec', { command: 'hostname' });
    expect(calls[0]!.alias).toEqual({ alias: 'my-server', authMode: 'password' });
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

  it('追加规则和损坏配置命中先于同步与SSH', async () => {
    const blocked = setup({
      workspace: {
        ...ws,
        policy: { customRules: [{ id: 'custom-marker', kind: 'contains', pattern: 'marker', reason: '禁止测试标记' }] },
      },
    });
    expect((await blocked.post('/internal/remote-exec', { command: 'echo marker' })).json()).toEqual({
      denied: { ruleId: 'custom-marker', reason: '禁止测试标记' },
    });
    expect(blocked.calls).toHaveLength(0);
    expect(blocked.sync.execute).not.toHaveBeenCalled();
    const invalid = setup({ workspace: { ...ws, policy: { extra: true } } as unknown as Workspace });
    expect((await invalid.post('/internal/remote-exec', { command: 'echo ok' })).json()).toMatchObject({
      denied: { ruleId: 'policy-invalid' },
    });
    expect(invalid.calls).toHaveLength(0);
    expect(invalid.sync.execute).not.toHaveBeenCalled();
    const nullPolicy = setup({ workspace: { ...ws, policy: null } as unknown as Workspace });
    expect((await nullPolicy.post('/internal/remote-exec', { command: 'echo ok' })).json()).toMatchObject({
      denied: { ruleId: 'policy-invalid' },
    });
    expect(nullPolicy.calls).toHaveLength(0);
    expect(nullPolicy.sync.execute).not.toHaveBeenCalled();
  });

  it('SSH 出错时返回 error 字段', async () => {
    const { post } = setup({ fail: true });
    const r = await post('/internal/remote-exec', { command: 'ls' });
    expect(r.json()).toMatchObject({ error: expect.stringContaining('SSH 连接') });
  });

  it('前同步失败不调用 SSH，后同步失败保留输出和退出码', async () => {
    const blocked = setup({ syncFail: true });
    expect((await blocked.post('/internal/remote-exec', { command: 'hostname' })).json()).toMatchObject({
      error: expect.stringContaining('命令未执行'),
    });
    expect(blocked.calls).toHaveLength(0);
    const completed = setup({ postFail: true });
    expect((await completed.post('/internal/remote-exec', { command: 'hostname' })).json()).toMatchObject({
      stdout: 'h1\n',
      exitCode: 0,
      sync: { phase: 'error' },
    });
  });

  it('手动同步同样需要内部会话令牌', async () => {
    const { post, sync } = setup();
    expect((await post('/internal/sync', {}, null)).statusCode).toBe(401);
    expect((await post('/internal/sync', {})).json()).toMatchObject({ sync: { phase: 'ready' } });
    expect(sync.sync).toHaveBeenCalledTimes(1);
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
