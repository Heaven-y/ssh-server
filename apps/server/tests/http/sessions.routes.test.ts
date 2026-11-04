import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef, Workspace } from '@agentdeck/shared';
import type { WorkspaceStore } from '../../src/workspaces/store';
import { registerSessionRoutes } from '../../src/http/sessions.routes';
import { createClaudeSessions, type ClaudeSessionsApi } from '../../src/agents/claude-sessions';
import { createSessionsService, SessionError, type SessionProvider } from '../../src/chat/sessions';

const ws: Workspace = {
  id: 'w1',
  name: 'demo',
  dir: path.join(os.tmpdir(), 'agentdeck-fixture', 'demo'),
  server: 'my-server',
  remoteDir: '~',
};
const other: Workspace = { id: 'w2', name: 'other', dir: path.join(os.tmpdir(), 'agentdeck-fixture', 'other') };
const store = {
  get: async (id: string) => (id === 'w1' ? ws : id === 'w2' ? other : undefined),
} as unknown as WorkspaceStore;

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function setup() {
  const api: ClaudeSessionsApi = {
    list: vi.fn(async () => [{ sessionId: 's1', summary: '调参', lastModified: 100, fileSize: 9 }]),
    info: vi.fn(async () => ({ sessionId: 's1', summary: '调参', lastModified: 100, cwd: ws.dir })),
    messages: vi.fn(async () => [
      {
        type: 'user',
        uuid: 'u1',
        session_id: 's1',
        message: { role: 'user', content: '你好' },
        parent_tool_use_id: null,
        parent_agent_id: null,
      },
      {
        type: 'assistant',
        uuid: 'a1',
        session_id: 's1',
        message: { id: 'm1', content: [{ type: 'text', text: '在' }] },
        parent_tool_use_id: null,
        parent_agent_id: null,
      },
    ]),
    rename: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    fork: vi.fn(async () => ({ sessionId: 'forked-session' })),
  };
  const app = Fastify();
  apps.push(app);
  const codex: SessionProvider = {
    list: vi.fn(async () => [{ sessionId: 's1', summary: 'Codex 调参', lastModified: 200 }]),
    read: vi.fn(async () => ({
      session: { sessionId: 's1', summary: 'Codex 调参', lastModified: 200 },
      cwd: ws.dir,
      actualModel: 'fixture-model',
      events: [{ type: 'text' as const, delta: 'Codex 回复' }],
    })),
    assertBelongs: vi.fn(async () => undefined),
    mutate: vi.fn(async () => undefined),
    fork: vi.fn(async () => ({
      session: { sessionId: 'forked-session', summary: 'Codex 分叉', lastModified: 200 },
      cwd: ws.dir,
    })),
  };
  const antigravity: SessionProvider = {
    // Antigravity 的列表不按目录过滤，归属只能靠 workspaceUris。
    list: vi.fn(async () => [
      {
        sessionId: 'a1',
        summary: '本项目的 Antigravity 会话',
        lastModified: 300,
        workspaceUris: pathToFileURL(ws.dir).href,
      },
      {
        sessionId: 'a2',
        summary: '其他项目的 Antigravity 会话',
        lastModified: 400,
        workspaceUris: pathToFileURL(other.dir).href,
      },
      {
        sessionId: 'a3',
        summary: '未归属的 Antigravity 会话',
        lastModified: 500,
        workspaceUris: 'https://example.com/x',
      },
    ]),
    read: vi.fn(async () => {
      throw new SessionError(501, 'session_not_replayable', '不可回放');
    }),
    assertBelongs: vi.fn(async () => undefined),
    mutate: vi.fn(async () => undefined),
    fork: vi.fn(async () => {
      throw new SessionError(400, 'unsupported_action', '不支持分叉');
    }),
  };
  const withIdleSession = vi.fn(async (_session: SessionRef) => undefined);
  const sessions = createSessionsService(
    { claude: createClaudeSessions(api), codex, antigravity },
    {
      withIdleSession: async (session, operation) => {
        await withIdleSession(session);
        return operation();
      },
      projects: async () => [ws, other],
    },
  );
  registerSessionRoutes(app, { store, sessions });
  return { app, api, codex, sessions, withIdleSession };
}

describe('会话接口', () => {
  it.each([
    { method: 'GET' as const, url: '/api/projects/w1/sessions' },
    { method: 'GET' as const, url: '/api/projects/w1/sessions/gemini/s1' },
    {
      method: 'POST' as const,
      url: '/api/projects/w1/sessions/unknown/s1/actions',
      payload: { action: 'rename', title: '新名称' },
    },
  ])('缺Agent或Agent非法时拒绝 $method $url，不能默认为Claude', async (request) => {
    const { app, api, codex, withIdleSession } = setup();
    expect((await app.inject(request)).statusCode).toBe(400);
    expect(api.list).not.toHaveBeenCalled();
    expect(api.messages).not.toHaveBeenCalled();
    expect(api.rename).not.toHaveBeenCalled();
    expect(codex.list).not.toHaveBeenCalled();
    expect(withIdleSession).not.toHaveBeenCalled();
  });

  it('会话管理校验确认与名称，并按原生身份加锁', async () => {
    const { app, codex, withIdleSession } = setup();
    const url = '/api/projects/w1/sessions/codex/s1/actions';
    for (const payload of [
      { action: 'delete' },
      { action: 'delete', confirmed: false },
      { action: 'rename', title: '  ' },
    ])
      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(400);
    expect(codex.mutate).not.toHaveBeenCalled();
    const renamed = await app.inject({ method: 'POST', url, payload: { action: 'rename', title: '  新名称  ' } });
    expect(renamed.statusCode).toBe(204);
    expect(renamed.headers['cache-control']).toBe('no-store');
    expect(withIdleSession).toHaveBeenCalledWith({ agent: 'codex', sessionId: 's1' });
    expect(codex.mutate).toHaveBeenCalledWith('s1', ws.dir, { action: 'rename', title: '新名称' });
    expect((await app.inject({ method: 'POST', url, payload: { action: 'delete', confirmed: true } })).statusCode).toBe(
      204,
    );
  });

  it.each([
    { method: 'GET' as const, url: '/api/projects/w1/sessions?agent=claude&extra=true' },
    { method: 'GET' as const, url: '/api/projects/w1/sessions/claude/s1?agent=codex' },
    {
      method: 'POST' as const,
      url: '/api/projects/w1/sessions/claude/s1/actions?agent=codex',
      payload: { action: 'rename', title: '新名称' },
    },
  ])('未知查询参数在原生访问前被拒绝且禁止缓存 $url', async (input) => {
    const { app, api, codex, withIdleSession } = setup();
    const response = await app.inject(input);
    expect(response.statusCode).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(api.list).not.toHaveBeenCalled();
    expect(api.messages).not.toHaveBeenCalled();
    expect(api.rename).not.toHaveBeenCalled();
    expect(codex.mutate).not.toHaveBeenCalled();
    expect(withIdleSession).not.toHaveBeenCalled();
  });

  it.each(['{"action":', ''])('动作 JSON 无法解析时仍禁止缓存，不触发原生写入：%j', async (payload) => {
    const { app, api, withIdleSession } = setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/w1/sessions/claude/s1/actions',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(api.info).not.toHaveBeenCalled();
    expect(withIdleSession).not.toHaveBeenCalled();
  });

  it('管理操作使用路径中的项目目录，跨项目删除被原生归属校验拒绝', async () => {
    const { app, api } = setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/w2/sessions/claude/s1/actions',
      payload: { action: 'delete', confirmed: true },
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(api.info).toHaveBeenCalledWith('s1', other.dir);
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('运行冲突返回409，原生异常匿名返回且不会误报管理成功', async () => {
    const { app, codex, withIdleSession } = setup();
    const request = {
      method: 'POST' as const,
      url: '/api/projects/w1/sessions/codex/s1/actions',
      payload: { action: 'archive' },
    };
    withIdleSession.mockRejectedValueOnce(new SessionError(409, 'session_busy', '会话正在运行'));
    expect((await app.inject(request)).statusCode).toBe(409);
    expect(codex.mutate).not.toHaveBeenCalled();
    vi.mocked(codex.mutate).mockRejectedValueOnce(new Error('private-native-details'));
    const failed = await app.inject(request);
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('private-native-details');
    expect((await app.inject(request)).statusCode).toBe(204);
  });

  it('归档查询只发给Codex，Claude归档操作被拒绝', async () => {
    const { app, codex } = setup();
    expect((await app.inject('/api/projects/w1/sessions?agent=codex&archived=true')).statusCode).toBe(200);
    expect(codex.list).toHaveBeenCalledWith(ws.dir, expect.any(AbortSignal), true);
    expect((await app.inject('/api/projects/w1/sessions?agent=claude&archived=true')).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/projects/w1/sessions/claude/s1/actions',
          payload: { action: 'archive' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('列出项目本地文件夹下的会话；没有 cwd 的老会话归为未归属', async () => {
    const { app, api } = setup();
    const r = await app.inject({ method: 'GET', url: '/api/projects/w1/sessions?agent=claude' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([
      {
        agent: 'claude',
        sessionId: 's1',
        // 列表行没带 cwd，不能拿「当前查的是 w1」兜底——否则同一条会话在每个项目下都出现。
        projectId: null,
        title: '调参',
        updatedAt: '1970-01-01T00:00:00.100Z',
        running: false,
      },
    ]);
    expect(api.list).toHaveBeenCalledWith(ws.dir);
  });

  it('Antigravity 按 workspace_uris 归属，未归属的行放行给「其他目录」', async () => {
    const { app } = setup();
    const mine = await app.inject({ method: 'GET', url: '/api/projects/w1/sessions?agent=antigravity' });
    expect(mine.statusCode).toBe(200);
    expect(
      mine
        .json()
        .map((session: { sessionId: string; projectId: string | null }) => [session.sessionId, session.projectId]),
    ).toEqual([
      ['a1', 'w1'],
      // projectId 为 null 的行必须放行：前端只能按项目取数，裁掉它「其他目录的会话」就永远没有数据。
      ['a3', null],
    ]);
    // 归属别的项目的行仍然被裁掉，不会漏进当前项目。
    const theirs = await app.inject({ method: 'GET', url: '/api/projects/w2/sessions?agent=antigravity' });
    expect(
      theirs
        .json()
        .map((session: { sessionId: string; projectId: string | null }) => [session.sessionId, session.projectId]),
    ).toEqual([
      ['a2', 'w2'],
      ['a3', null],
    ]);
  });

  it('适配器未接入时按 agent_unavailable 拒绝，不静默当成别的 CLI', async () => {
    const app = Fastify();
    apps.push(app);
    const sessions = createSessionsService({}, { withIdleSession: (_session, operation) => operation() });
    registerSessionRoutes(app, { store, sessions });
    const response = await app.inject({ method: 'GET', url: '/api/projects/w1/sessions?agent=antigravity' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: 'agent_unavailable', message: 'Antigravity 适配器尚未接入' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('非法的 agent 查询在项目查找之前就被拒绝', async () => {
    const { app, api } = setup();
    const response = await app.inject({ method: 'GET', url: '/api/projects/nope/sessions?agent=gemini' });
    expect(response.statusCode).toBe(400);
    expect(api.list).not.toHaveBeenCalled();
  });

  it('返回会话历史对应的事件，Antigravity 不可回放时保留 501 语义', async () => {
    const { app, api } = setup();
    const r = await app.inject({ method: 'GET', url: '/api/projects/w1/sessions/claude/s1' });
    expect(r.json().session).toMatchObject({ agent: 'claude', sessionId: 's1' });
    expect(r.json().events).toEqual([
      { type: 'user_message', text: '你好' },
      { type: 'text', delta: '在' },
    ]);
    expect(api.messages).toHaveBeenCalledWith('s1', ws.dir);
    // Task 11 的「不可回放」文案要靠这个错误码推导，不能在路由层被改写成通用 503。
    const replay = await app.inject('/api/projects/w1/sessions/antigravity/a1');
    expect(replay.statusCode).toBe(501);
    expect(replay.json()).toMatchObject({ code: 'session_not_replayable' });
    expect(replay.headers['cache-control']).toBe('no-store');
  });

  it('旧会话读取、动作和分叉路径全部删除，不保留兼容别名', async () => {
    const { app, api, codex } = setup();
    const requests = [
      { method: 'GET' as const, url: '/api/workspaces/w1/sessions?agent=claude' },
      { method: 'GET' as const, url: '/api/workspaces/w1/sessions/s1/events?agent=claude' },
      {
        method: 'POST' as const,
        url: '/api/workspaces/w1/sessions/s1/actions?agent=codex',
        payload: { action: 'delete', confirmed: true },
      },
      { method: 'POST' as const, url: '/api/workspaces/w1/sessions/s1/fork?agent=claude', payload: {} },
    ];
    for (const request of requests) expect((await app.inject(request)).statusCode).toBe(404);
    expect(api.list).not.toHaveBeenCalled();
    expect(api.messages).not.toHaveBeenCalled();
    expect(api.fork).not.toHaveBeenCalled();
    expect(codex.mutate).not.toHaveBeenCalled();
  });

  it('项目不存在 404，会话 id 与 agent 不合法 400', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'GET', url: '/api/projects/nope/sessions?agent=claude' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/projects/nope/sessions/claude/s1' })).statusCode).toBe(404);
    const invalid = await app.inject({ method: 'GET', url: '/api/projects/w1/sessions/claude/a.b' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.headers['cache-control']).toBe('no-store');
    expect((await app.inject('/api/projects/w1/sessions?agent=unknown')).statusCode).toBe(400);
  });

  it.each(['list', 'read'] as const)('读取 %s 时 HTTP 断开会取消原生读取', async (operation) => {
    const { app, codex } = setup();
    let nativeSignal: AbortSignal | undefined;
    const waitUntilAbort = (signal?: AbortSignal) => {
      nativeSignal = signal;
      return new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('fixture-cancelled')), { once: true });
      });
    };
    if (operation === 'list') vi.mocked(codex.list).mockImplementationOnce((_dir, signal) => waitUntilAbort(signal));
    else vi.mocked(codex.read).mockImplementationOnce((_id, _dir, signal) => waitUntilAbort(signal));
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const url = operation === 'list' ? '/api/projects/w1/sessions?agent=codex' : '/api/projects/w1/sessions/codex/s1';
    const client = request(`${origin}${url}`);
    client.on('error', () => undefined);
    client.end();
    try {
      await vi.waitFor(() => expect(nativeSignal).toBeDefined());
      client.destroy();
      await vi.waitFor(() => expect(nativeSignal?.aborted).toBe(true));
    } finally {
      client.destroy();
    }
  });

  it('原生列表过滤其他工作区，历史显示最后实际模型，续接校验拒绝错误身份', async () => {
    const { app, api, sessions } = setup();
    vi.mocked(api.list).mockResolvedValueOnce([
      { sessionId: 's1', summary: '本项目', lastModified: 100, cwd: ws.dir },
      { sessionId: 'foreign', summary: '其他项目', lastModified: 200, cwd: path.join(ws.dir, 'other') },
    ]);
    expect((await app.inject('/api/projects/w1/sessions?agent=claude')).json()).toEqual([
      {
        agent: 'claude',
        sessionId: 's1',
        projectId: 'w1',
        title: '本项目',
        updatedAt: '1970-01-01T00:00:00.100Z',
        running: false,
      },
    ]);
    vi.mocked(api.messages).mockResolvedValueOnce([
      { type: 'assistant', message: { model: 'old-model', content: [] } },
      { type: 'assistant', message: { model: 'latest-model', content: [] } },
      { type: 'system', subtype: 'status' },
    ]);
    expect((await app.inject('/api/projects/w1/sessions/claude/s1')).json().actualModel).toBe('latest-model');
    await sessions.assertBelongs(ws, 'claude', 's1');
    await expect(sessions.assertBelongs(ws, 'claude', 'wrong-id')).rejects.toMatchObject({ status: 404 });
  });

  it('共享服务复核提供方身份与目录，原生异常转换为匿名错误', async () => {
    const { sessions, codex } = setup();
    vi.mocked(codex.read).mockResolvedValueOnce({
      session: { sessionId: 'other-id', summary: '错误身份', lastModified: 100 },
      cwd: ws.dir,
      events: [],
    });
    await expect(sessions.read(ws, 'codex', 's1')).rejects.toMatchObject({ status: 404 });
    const signal = new AbortController().signal;
    vi.mocked(codex.assertBelongs).mockRejectedValueOnce(new Error('private-runtime-detail'));
    await expect(sessions.assertBelongs(ws, 'codex', 's1', signal)).rejects.toMatchObject({
      status: 503,
      message: 'Codex 会话读取失败，请检查本机运行时与配置',
    });
    expect(codex.assertBelongs).toHaveBeenCalledWith('s1', ws.dir, signal);
  });

  it('两类同 ID 会话独立读取，拒绝跨目录记录，单源失败不影响另一类', async () => {
    const { app, api, codex } = setup();
    const listed = await app.inject('/api/projects/w1/sessions?agent=codex');
    expect(listed.json()).toEqual([
      {
        agent: 'codex',
        sessionId: 's1',
        projectId: null,
        title: 'Codex 调参',
        updatedAt: '1970-01-01T00:00:00.200Z',
        running: false,
      },
    ]);
    const history = await app.inject('/api/projects/w1/sessions/codex/s1');
    expect(history.json()).toMatchObject({
      session: { agent: 'codex', sessionId: 's1' },
      actualModel: 'fixture-model',
    });
    expect(api.messages).not.toHaveBeenCalled();
    vi.mocked(api.info).mockResolvedValueOnce({
      sessionId: 's1',
      summary: '另一个目录',
      lastModified: 100,
      cwd: path.join(ws.dir, 'other'),
    });
    expect((await app.inject('/api/projects/w1/sessions/claude/s1')).statusCode).toBe(404);
    vi.mocked(codex.list).mockRejectedValueOnce(new Error('secret-sentinel'));
    const failed = await app.inject('/api/projects/w1/sessions?agent=codex');
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('secret-sentinel');
    expect(failed.headers['cache-control']).toBe('no-store');
    expect((await app.inject('/api/projects/w1/sessions?agent=claude')).statusCode).toBe(200);
  });
});
