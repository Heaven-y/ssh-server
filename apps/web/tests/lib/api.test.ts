import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, queryKeys } from '../../src/lib/api';

const localDir = path.join(os.tmpdir(), 'ssh-server-fixture', 'demo');
const respond = (status: number, body?: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('成功时返回 JSON；POST 带 content-type', async () => {
    respond(201, { id: 'w1' });
    await expect(api.createWorkspace({ name: 'n', localDir, sshHost: 'h', remoteDir: '~' })).resolves.toEqual({
      id: 'w1',
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/workspaces');
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } });
  });

  it('接口错误保留字段名、分类及部分恢复路径', async () => {
    respond(400, { field: 'localDir', message: '本地文件夹不存在' });
    const err = await api.listWorkspaces().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, field: 'localDir', message: '本地文件夹不存在' });
    respond(500, { code: 'partial_restore', message: '部分文件恢复失败', affectedPaths: ['main.py'] });
    await expect(api.restoreVersion('w1', { commit: 'a'.repeat(40), revision: 'b'.repeat(64) })).rejects.toMatchObject({
      status: 500,
      code: 'partial_restore',
      affectedPaths: ['main.py'],
    });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toMatchObject({ confirmed: true });
  });

  it('401 提示打开访问地址；无 JSON 的错误给出状态码', async () => {
    respond(401);
    await expect(api.listSshHosts()).rejects.toThrow('访问地址');
    respond(500);
    await expect(api.listSshHosts()).rejects.toThrow('请求失败（500）');
  });

  it('会话请求和缓存按 Agent 隔离，历史读取传递取消信号', async () => {
    respond(200, []);
    await api.sessionEvents('w/1', 's 1');
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/workspaces/w%2F1/sessions/s%201/events?agent=claude');
    await api.listSessions('w/1', 'codex');
    expect(vi.mocked(fetch).mock.calls[1]).toEqual([
      '/api/workspaces/w%2F1/sessions?agent=codex',
      expect.objectContaining({ cache: 'no-store' }),
    ]);
    const controller = new AbortController();
    await api.sessionEvents('w/1', 's 1', 'codex', controller.signal);
    expect(vi.mocked(fetch).mock.calls[2]).toEqual([
      '/api/workspaces/w%2F1/sessions/s%201/events?agent=codex',
      expect.objectContaining({ cache: 'no-store', signal: controller.signal }),
    ]);
    expect(queryKeys.sessions('w/1')).not.toEqual(queryKeys.sessions('w/1', 'codex'));
  });

  it('密码和保存偏好仅发送到认证接口，取消保存只发送目标', async () => {
    respond(200, { connected: true, authMode: 'password', saved: true, savingAvailable: true, paused: false });
    await api.connectSsh({
      sshHost: 'my-server',
      remoteDir: '~/projects/demo',
      authMode: 'password',
      password: 'fixture-secret',
      savePassword: true,
    });
    expect(vi.mocked(fetch).mock.calls[0]).toEqual([
      '/api/ssh/connect',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sshHost: 'my-server',
          authMode: 'password',
          remoteDir: '~/projects/demo',
          password: 'fixture-secret',
          savePassword: true,
        }),
      }),
    ]);
    await api.clearSavedSshPassword('my-server');
    expect(vi.mocked(fetch).mock.calls[1]).toEqual([
      '/api/ssh/credentials',
      expect.objectContaining({ method: 'PUT', body: '{"sshHost":"my-server","savePassword":false}' }),
    ]);
    await api.sshCredentials('my/server');
    expect(vi.mocked(fetch).mock.calls[2]).toEqual([
      '/api/ssh/credentials?sshHost=my%2Fserver',
      expect.objectContaining({ cache: 'no-store' }),
    ]);
  });

  it('同步决策只走对应工作区接口，创建不附带密码', async () => {
    respond(200, { phase: 'ready' });
    await api.initializeSync('w/1');
    expect(vi.mocked(fetch).mock.calls[0]).toEqual([
      '/api/workspaces/w%2F1/sync/initialize',
      expect.objectContaining({ method: 'POST', body: '{"confirmed":true}' }),
    ]);
    await api.decideSyncDeletions('w/1', 'reject');
    expect(vi.mocked(fetch).mock.calls[1]).toEqual([
      '/api/workspaces/w%2F1/sync/deletions',
      expect.objectContaining({ body: '{"decision":"reject"}' }),
    ]);
    const input = {
      name: 'n',
      localDir,
      sshHost: 'h',
      remoteDir: '~',
      password: 'never-save',
      savePassword: true,
      sync: { maxFileBytes: 100, excludedExtensions: [] },
    };
    await api.createWorkspace(input);
    const body = vi.mocked(fetch).mock.calls[2]![1]!.body as string;
    expect(body).not.toContain('never-save');
    expect(JSON.parse(body)).not.toHaveProperty('savePassword');
    expect(JSON.parse(body)).toMatchObject({ sync: input.sync });
  });
});
