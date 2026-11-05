import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, queryKeys } from '../../src/lib/api';

const respond = (status: number, body?: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('Slurm只读请求固定目标、取消信号和no-store，不发送认证材料或任务动作', async () => {
    const target = { workspaceId: 'w/1', sshHost: 'my-server', remoteDir: '~/projects/demo & notes' };
    const result = { status: 'available', sampledAt: 1, output: '', truncated: false };
    respond(200, result);
    expect(api).toHaveProperty('readSlurm', expect.any(Function));
    const controller = new AbortController();
    await expect(api.readSlurm(target, controller.signal)).resolves.toEqual(result);
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    const parsed = new URL(url as string, 'https://example.invalid');
    expect(parsed.pathname).toBe('/api/workspaces/w%2F1/slurm');
    expect(JSON.parse(parsed.searchParams.get('target')!)).toEqual(target);
    expect(options).toMatchObject({ signal: controller.signal, cache: 'no-store' });
    expect(options?.body).toBeUndefined();
    expect(options?.method).toBeUndefined();
  });

  it('服务器浏览请求保留绑定令牌并正确传递工作区、目录和游标', async () => {
    const target = { sshHost: 'my-server', remoteDir: '~/projects/demo' };
    respond(200, { binding: 'fixture-binding' });
    const identity = await api.bindRemoteBrowseTarget('w/1', target);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/workspaces/w%2F1/remote-files/bindings');
    respond(200, { id: 'session/one' });
    const controller = new AbortController();
    await api.createRemoteBrowseSession('w/1', target, identity.binding, controller.signal);
    const created = vi.mocked(fetch).mock.calls[0]?.[1];
    const createdBody = JSON.parse(created?.body as string);
    expect(createdBody).toMatchObject({ ...target, binding: identity.binding });
    // 绑定快照只带服务器别名与目录；工作区模型收敛后不再发送本地目录。
    expect(createdBody).not.toHaveProperty('localDir');
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
    await api.agentCapabilities('w/1', 'codex', controller.signal, 'native/id');
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe(
      '/api/workspaces/w%2F1/agent-capabilities?agent=codex&sessionId=native%2Fid',
    );
    expect(queryKeys.agentCapabilities('w/1', 'codex', 'one')).not.toEqual(
      queryKeys.agentCapabilities('w/1', 'codex', 'two'),
    );
  });

  it('显式刷新能力走POST，普通读取仍是GET', async () => {
    respond(200, { agent: 'antigravity', entries: [], models: [], warnings: [] });
    await api.agentCapabilities('project/one', 'antigravity');
    await api.refreshAgentCapabilities('project/one', 'antigravity');
    const [read, refresh] = vi.mocked(fetch).mock.calls;
    expect(read?.[1]?.method).toBeUndefined();
    expect(refresh?.[0]).toBe('/api/workspaces/project%2Fone/agent-capabilities?agent=antigravity');
    expect(refresh?.[1]).toMatchObject({ method: 'POST', cache: 'no-store', body: '{}' });
  });

  it('成功时返回 JSON；POST 带 content-type', async () => {
    respond(201, { alias: 'my-server' });
    await expect(
      api.saveSshTarget({ name: 'n', hostname: 'my-server', username: 'demo', port: 22, authMode: 'key' }),
    ).resolves.toEqual({ alias: 'my-server' });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/ssh-targets');
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } });
  });

  it('接口错误保留字段名、分类及部分恢复路径', async () => {
    respond(400, { field: 'dir', message: '项目目录不存在' });
    const err = await api.listWorkspaces().catch((e: unknown) => e);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/projects');
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, field: 'dir', message: '项目目录不存在' });
    respond(500, { code: 'partial_restore', message: '部分文件恢复失败', affectedPaths: ['main.py'] });
    await expect(api.deleteSshTarget({ alias: 'my-server' } as never)).rejects.toMatchObject({
      status: 500,
      code: 'partial_restore',
      affectedPaths: ['main.py'],
    });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toMatchObject({ confirmed: true });
  });

  it('401 提示刷新本机会话；无 JSON 的错误给出状态码', async () => {
    respond(401);
    await expect(api.listSshHosts()).rejects.toThrow('刷新页面');
    respond(500);
    await expect(api.listSshHosts()).rejects.toThrow('请求失败（500）');
  });

  it('会话请求和缓存按 Agent 隔离，历史读取传递取消信号', async () => {
    respond(200, []);
    await api.sessionEvents('w/1', 's 1', 'claude');
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/projects/w%2F1/sessions/claude/s%201');
    await api.listSessions('w/1', 'codex');
    expect(vi.mocked(fetch).mock.calls[1]).toEqual([
      '/api/projects/w%2F1/sessions?agent=codex',
      expect.objectContaining({ cache: 'no-store' }),
    ]);
    const controller = new AbortController();
    await api.sessionEvents('w/1', 's 1', 'codex', controller.signal);
    expect(vi.mocked(fetch).mock.calls[2]).toEqual([
      '/api/projects/w%2F1/sessions/codex/s%201',
      expect.objectContaining({ cache: 'no-store', signal: controller.signal }),
    ]);
    expect(queryKeys.sessions('w/1', 'claude')).not.toEqual(queryKeys.sessions('w/1', 'codex'));
  });

  it('归档查询独立缓存，管理 POST 保留确认且不绑定取消信号', async () => {
    respond(200, []);
    await api.listSessions('w/1', 'claude');
    await api.listSessions('w/1', 'codex', true);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      '/api/projects/w%2F1/sessions?agent=claude',
      '/api/projects/w%2F1/sessions?agent=codex&archived=true',
    ]);
    expect(queryKeys.sessions('w/1', 'codex')).toEqual(['sessions', 'w/1', 'codex']);
    expect(queryKeys.sessions('w/1', 'codex', true)).toEqual(['sessions', 'w/1', 'codex', 'archived']);

    respond(204);
    await expect(
      api.sessionAction('w/1', 's 1', 'codex', { action: 'delete', confirmed: true }),
    ).resolves.toBeUndefined();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/projects/w%2F1/sessions/codex/s%201/actions');
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
      password: 'fixture-secret',
      savePassword: true,
    });
    expect(vi.mocked(fetch).mock.calls[0]).toEqual([
      '/api/ssh/connect',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sshHost: 'my-server',
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

  it('远端文件操作只走对应工作区接口，提交绑定确认预检', async () => {
    respond(200, { path: 'a.txt' });
    await api.remoteFileTaskAction('w/1', 'task 1', 'check');
    expect(vi.mocked(fetch).mock.calls[0]).toEqual([
      '/api/workspaces/w%2F1/remote-files/tasks/task%201/check',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    ]);
    respond(200, { id: 'preflight' });
    await api.submitRemoteFileTask('w/1', 'preflight-1');
    expect(vi.mocked(fetch).mock.calls[0]).toEqual([
      '/api/workspaces/w%2F1/remote-files/tasks',
      expect.objectContaining({ body: JSON.stringify({ preflightId: 'preflight-1', confirmed: true }) }),
    ]);
    expect(api).not.toHaveProperty('recoverRemoteFileTask');
  });
});
