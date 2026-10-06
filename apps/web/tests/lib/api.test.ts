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
  it('服务器浏览请求保留绑定令牌并正确传递工作区、目录和游标', async () => {
    const target = { sshHost: 'my-server', remoteDir: '~/projects/demo', localDir };
    respond(200, { binding: 'fixture-binding' });
    const identity = await api.bindRemoteBrowseTarget('w/1', target);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/workspaces/w%2F1/remote-files/bindings');
    respond(200, { id: 'session/one' });
    const controller = new AbortController();
    await api.createRemoteBrowseSession('w/1', target, identity.binding, controller.signal);
    const created = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(created?.body as string)).toMatchObject({ ...target, binding: identity.binding });
    expect(created?.signal).toBe(controller.signal);
    const remote = path.posix.join(path.posix.sep, 'fixture-home', 'data & weights');
    respond(200, { path: remote, entries: [] });
    await api.listRemoteFiles('w/1', 'session/one', { path: remote, cursor: 'next-page' }, controller.signal);
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    const parsed = new URL(url as string, 'https://example.invalid');
    expect(parsed.pathname).toBe('/api/workspaces/w%2F1/remote-files/sessions/session%2Fone');
    expect(parsed.searchParams.get('path')).toBe(remote);
    expect(parsed.searchParams.get('cursor')).toBe('next-page');
    expect(options).toMatchObject({ signal: controller.signal, cache: 'no-store' });
    respond(204);
    await api.closeRemoteBrowseSession('w/1', 'session/one');
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE', keepalive: true });
  });

  it('能力请求按工作区与 Agent 隔离缓存键，并传递取消信号和 no-store', async () => {
    const result = { agent: 'codex', entries: [], models: [], warnings: ['部分能力不可用'] };
    respond(200, result);
    const controller = new AbortController();
    await expect(api.agentCapabilities('w/1', 'codex', controller.signal)).resolves.toEqual(result);
    expect(vi.mocked(fetch).mock.calls[0]).toEqual([
      '/api/workspaces/w%2F1/agent-capabilities?agent=codex',
      expect.objectContaining({ signal: controller.signal, cache: 'no-store' }),
    ]);
    expect(queryKeys.agentCapabilities('w/1', 'codex')).toEqual(['agent-capabilities', 'w/1', 'codex']);
    expect(queryKeys.agentCapabilities('w/1', 'codex')).not.toEqual(queryKeys.agentCapabilities('w/1', 'claude'));
    expect(queryKeys.agentCapabilities('w/1', 'codex')).not.toEqual(queryKeys.agentCapabilities('w2', 'codex'));
  });

  it('成功时返回 JSON；POST 带 content-type', async () => {
    respond(201, { id: 'w1' });
    await expect(
      api.createVerifiedWorkspace({
        input: { name: 'n', localDir, sshHost: 'h', remoteDir: '~' },
        verification: '11111111-1111-4111-8111-111111111111',
        initializationConfirmed: true,
      }),
    ).resolves.toEqual({ id: 'w1' });
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
    await api.sessionEvents('w/1', 's 1', 'claude');
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
    expect(queryKeys.sessions('w/1', 'claude')).not.toEqual(queryKeys.sessions('w/1', 'codex'));
  });

  it('归档查询独立缓存，管理 POST 保留确认且不绑定取消信号', async () => {
    respond(200, []);
    await api.listSessions('w/1', 'claude');
    await api.listSessions('w/1', 'codex', true);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      '/api/workspaces/w%2F1/sessions?agent=claude',
      '/api/workspaces/w%2F1/sessions?agent=codex&archived=true',
    ]);
    expect(queryKeys.sessions('w/1', 'codex')).toEqual(['sessions', 'w/1', 'codex']);
    expect(queryKeys.sessions('w/1', 'codex', true)).toEqual(['sessions', 'w/1', 'codex', 'archived']);

    respond(204);
    await expect(
      api.sessionAction('w/1', 's 1', 'codex', { action: 'delete', confirmed: true }),
    ).resolves.toBeUndefined();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/workspaces/w%2F1/sessions/s%201/actions?agent=codex');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete', confirmed: true }),
    });
    expect(init).not.toHaveProperty('signal');
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
    await api.createVerifiedWorkspace({
      input,
      verification: '11111111-1111-4111-8111-111111111111',
      initializationConfirmed: true,
    });
    const body = vi.mocked(fetch).mock.calls[2]![1]!.body as string;
    expect(body).not.toContain('never-save');
    expect(JSON.parse(body).input).not.toHaveProperty('savePassword');
    expect(JSON.parse(body)).toMatchObject({
      input: { sync: input.sync },
      verification: '11111111-1111-4111-8111-111111111111',
      initializationConfirmed: true,
    });
  });
});
