import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import type { AgentKind, Workspace } from '@ssh-server/shared';
import type { NativeSessionRead } from '../../src/agents/types';
import { createClaudeSessions } from '../../src/agents/claude-sessions';
import { createSessionRegistry } from '../../src/chat/registry';
import { createSessionsService, SessionError } from '../../src/chat/sessions';
import { TurnManager } from '../../src/chat/turn-manager';
import { registerSessionRoutes } from '../../src/http/sessions.routes';

const ws: Workspace = {
  id: 'w1',
  name: '分叉测试',
  localDir: path.join(tmpdir(), 'ssh-server-fork-fixture', 'workspace'),
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
};
const sourceId = 'source-session';
const forkedId = 'forked-session';
const forked = {
  session: { sessionId: forkedId, summary: '原生分叉', lastModified: 200 },
  cwd: ws.localDir,
};
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup() {
  const api = {
    list: vi.fn(async () => []),
    info: vi.fn(async (id: string): Promise<SDKSessionInfo | undefined> => ({
      sessionId: id,
      summary: id === sourceId ? '源会话' : '原生分叉',
      lastModified: id === sourceId ? 100 : 200,
      cwd: ws.localDir,
    })),
    messages: vi.fn(async (): Promise<unknown[]> => [
      {
        type: 'assistant',
        uuid: 'native-point',
        session_id: sourceId,
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: {
          id: 'model-message',
          role: 'assistant',
          content: [{ type: 'text', text: '完整回复' }],
          stop_reason: 'end_turn',
        },
      },
    ]),
    rename: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    fork: vi.fn(async (_id: string, _dir: string, _input: { pointId?: string }) => ({ sessionId: forkedId })),
  };
  const codex = {
    list: vi.fn(async () => []),
    read: vi.fn(async (): Promise<NativeSessionRead> => ({
      session: { sessionId: sourceId, summary: '源会话', lastModified: 100 },
      cwd: ws.localDir,
      events: [],
    })),
    assertBelongs: vi.fn(async () => undefined),
    mutate: vi.fn(async () => undefined),
    fork: vi.fn(async (_id: string, _dir: string, _input: { pointId?: string }) => forked),
  };
  const turns = new TurnManager({
    getWorkspace: async () => ws,
    registry: createSessionRegistry(),
    internalUrl: () => 'http://127.0.0.1:1',
    runners: {},
    sessions: { assertBelongs: async () => undefined },
    sync: {
      sync: async () => {
        throw new Error('分叉不得运行同步或文件回退');
      },
    },
  });
  const sessions = createSessionsService({ claude: createClaudeSessions(api), codex }, turns);
  const app = Fastify();
  apps.push(app);
  registerSessionRoutes(app, { store: { get: async (id) => (id === ws.id ? ws : undefined) }, sessions });
  const post = (agent: AgentKind, payload: unknown = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/workspaces/w1/sessions/${sourceId}/fork?agent=${agent}`,
      payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });
  return { app, api, codex, turns, post };
}

describe('原生会话分叉 HTTP 契约', () => {
  it.each(['claude', 'codex'] as const)('%s 指定原生点及默认末尾返回新会话且禁止缓存', async (agent) => {
    const { post, api, codex } = setup();
    for (const payload of [{ pointId: 'native-point' }, {}]) {
      const response = await post(agent, payload);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        session: { agent, sessionId: forkedId, summary: '原生分叉', lastModified: 200 },
      });
    }
    const nativeFork = agent === 'claude' ? api.fork : codex.fork;
    expect(nativeFork).toHaveBeenNthCalledWith(1, sourceId, ws.localDir, { pointId: 'native-point' });
    expect(nativeFork).toHaveBeenNthCalledWith(2, sourceId, ws.localDir, {});
    expect(api.rename).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
    expect(codex.mutate).not.toHaveBeenCalled();
  });

  it.each(
    [
      null,
      [],
      'native-point',
      { pointId: '' },
      { pointId: 1 },
      { pointId: null },
      { pointId: '../outside' },
      { pointId: 'a/b' },
      { pointId: 'a\\b' },
      { pointId: 'a.b' },
      { pointId: 'x'.repeat(101) },
      { pointId: ' native-point ' },
      { path: 'elsewhere' },
      { pointId: 'native-point', extra: true },
    ].map((payload) => ({ payload })),
  )('严格拒绝非法分叉输入 $payload，不能传入路径或未知字段', async ({ payload }) => {
    const { post, api, codex } = setup();
    const response = await post('codex', payload);
    expect(response.statusCode).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(codex.fork).not.toHaveBeenCalled();
    expect(api.fork).not.toHaveBeenCalled();
  });

  it.each(['{"pointId":', ''])('JSON 无法解析时仍禁止缓存，不触发原生请求：%j', async (payload) => {
    const { app, codex, api } = setup();
    const response = await app.inject({
      method: 'POST',
      url: `/api/workspaces/w1/sessions/${sourceId}/fork?agent=codex`,
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(codex.fork).not.toHaveBeenCalled();
    expect(api.info).not.toHaveBeenCalled();
  });

  it.each([
    `/api/workspaces/w1/sessions/${sourceId}/fork`,
    `/api/workspaces/w1/sessions/${sourceId}/fork?agent=unknown`,
    `/api/workspaces/w1/sessions/${sourceId}/fork?agent=codex&path=elsewhere`,
    '/api/workspaces/w1/sessions/a.b/fork?agent=claude',
  ])('拒绝缺失 Agent 或非法路由参数 %s', async (url) => {
    const { app, codex, api } = setup();
    const response = await app.inject({ method: 'POST', url, payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(codex.fork).not.toHaveBeenCalled();
    expect(api.info).not.toHaveBeenCalled();
  });

  it('工作区不存在时不读取任何原生记录', async () => {
    const { app, codex, api } = setup();
    const response = await app.inject({
      method: 'POST',
      url: `/api/workspaces/missing/sessions/${sourceId}/fork?agent=claude`,
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(codex.fork).not.toHaveBeenCalled();
    expect(api.info).not.toHaveBeenCalled();
  });

  it.each(['claude', 'codex'] as const)('%s 忙时在任何原生读取前拒绝，释放后允许分叉', async (agent) => {
    const { turns, post, codex, api } = setup();
    const gate = deferred<void>();
    const held = turns.withIdleSession({ agent, sessionId: sourceId }, () => gate.promise);
    try {
      const busy = await post(agent);
      expect(busy.statusCode).toBe(409);
      expect(busy.json()).toMatchObject({ code: 'session_busy' });
      expect(busy.headers['cache-control']).toBe('no-store');
      expect(codex.fork).not.toHaveBeenCalled();
      expect(api.info).not.toHaveBeenCalled();
    } finally {
      gate.resolve();
      await held;
    }
    expect((await post(agent)).statusCode).toBe(200);
  });

  it('Claude 归属异步核验开始前已占源锁，另一 Agent 的同 ID 不受影响', async () => {
    const { api, post } = setup();
    const gate = deferred<SDKSessionInfo | undefined>();
    api.info.mockImplementationOnce(() => gate.promise);
    const pending = post('claude');
    try {
      await vi.waitFor(() => expect(api.info).toHaveBeenCalled());
      expect((await post('claude')).statusCode).toBe(409);
      expect((await post('codex')).statusCode).toBe(200);
    } finally {
      gate.resolve({ sessionId: sourceId, summary: '源会话', lastModified: 100, cwd: ws.localDir });
    }
    expect((await pending).statusCode).toBe(200);
    expect((await post('claude')).statusCode).toBe(200);
  });

  it.each(['claude', 'codex'] as const)('%s 原生失败匿名返回并释放锁，不误报成功', async (agent) => {
    const { post, api, codex } = setup();
    if (agent === 'claude') api.fork.mockRejectedValueOnce(new Error('fixture-sensitive-native-error'));
    else codex.fork.mockRejectedValueOnce(new Error('fixture-sensitive-native-error'));
    const failed = await post(agent);
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toMatchObject({ code: 'session_runtime_failed' });
    expect(failed.body).not.toContain('fixture-sensitive-native-error');
    expect(failed.headers['cache-control']).toBe('no-store');
    expect((await post(agent)).statusCode).toBe(200);
  });

  it('给定点不属于 Claude 源或尚未结束时拒绝，不交给 SDK', async () => {
    const { api, post } = setup();
    const invalid = await post('claude', { pointId: 'another-session-point' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'invalid_fork_point' });
    expect(api.fork).not.toHaveBeenCalled();
    expect((await post('claude', { pointId: 'native-point' })).statusCode).toBe(200);
  });

  it.each([
    { session: { ...forked.session, sessionId: sourceId }, cwd: ws.localDir },
    { session: { ...forked.session, sessionId: '' }, cwd: ws.localDir },
    { session: { ...forked.session, sessionId: '../outside' }, cwd: ws.localDir },
    { session: forked.session, cwd: path.join(ws.localDir, 'other') },
  ])('服务再次核验提供方的新 ID/目录，异常结果不返回且释放锁：%j', async (invalid) => {
    const { post, codex } = setup();
    codex.fork.mockResolvedValueOnce(invalid);
    const response = await post('codex');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'session_runtime_failed' });
    expect((await post('codex')).statusCode).toBe(200);
  });

  it('原生 SessionError 保留安全分类', async () => {
    const { post, codex } = setup();
    codex.fork.mockRejectedValueOnce(new SessionError(404, 'session_missing', '当前工作区没有此会话'));
    const response = await post('codex');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'session_missing', message: '当前工作区没有此会话' });
  });

  it('原生请求发出后 HTTP 断开不撤销，继续等结果收束并释放源锁', async () => {
    const { app, post, codex } = setup();
    const gate = deferred<typeof forked>();
    codex.fork.mockImplementationOnce(() => gate.promise);
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const closed = deferred<void>();
    const client = request(`${origin}/api/workspaces/w1/sessions/${sourceId}/fork?agent=codex`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    client.on('error', () => closed.resolve());
    client.end('{}');
    try {
      await vi.waitFor(() => expect(codex.fork).toHaveBeenCalledOnce());
      client.destroy();
      await closed.promise;
      expect((await post('codex')).statusCode).toBe(409);
    } finally {
      client.destroy();
      gate.resolve(forked);
    }
    await vi.waitFor(async () => expect((await post('codex')).statusCode).toBe(200));
  });
});
