import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '@ssh-server/shared';
import type { WorkspaceStore } from '../../src/workspaces/store';
import { registerSessionRoutes } from '../../src/http/sessions.routes';
import { createClaudeSessions, type ClaudeSessionsApi } from '../../src/agents/claude-sessions';
import { createSessionsService, type SessionProvider } from '../../src/chat/sessions';

const ws: Workspace = {
  id: 'w1',
  name: 'demo',
  localDir: path.join(os.tmpdir(), 'ssh-server-fixture', 'demo'),
  sshHost: 'my-server',
  remoteDir: '~',
};
const store = { get: async (id: string) => (id === 'w1' ? ws : undefined) } as unknown as WorkspaceStore;

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function setup() {
  const api: ClaudeSessionsApi = {
    list: vi.fn(async () => [{ sessionId: 's1', summary: '调参', lastModified: 100, fileSize: 9 }]),
    info: vi.fn(async () => ({ sessionId: 's1', summary: '调参', lastModified: 100, cwd: ws.localDir })),
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
  };
  const app = Fastify();
  apps.push(app);
  const codex: SessionProvider = {
    list: vi.fn(async () => [{ sessionId: 's1', summary: 'Codex 调参', lastModified: 200 }]),
    read: vi.fn(async () => ({
      session: { sessionId: 's1', summary: 'Codex 调参', lastModified: 200 },
      cwd: ws.localDir,
      actualModel: 'fixture-model',
      events: [{ type: 'text' as const, delta: 'Codex 回复' }],
    })),
    assertBelongs: vi.fn(async () => undefined),
  };
  const sessions = createSessionsService({ claude: createClaudeSessions(api), codex });
  registerSessionRoutes(app, { store, sessions });
  return { app, api, codex, sessions };
}

describe('会话接口', () => {
  it('列出工作区本地文件夹下的会话', async () => {
    const { app, api } = setup();
    const r = await app.inject({ method: 'GET', url: '/api/workspaces/w1/sessions' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([{ agent: 'claude', sessionId: 's1', summary: '调参', lastModified: 100 }]);
    expect(api.list).toHaveBeenCalledWith(ws.localDir);
  });

  it('返回会话历史对应的事件', async () => {
    const { app, api } = setup();
    const r = await app.inject({ method: 'GET', url: '/api/workspaces/w1/sessions/s1/events' });
    expect(r.json().session).toMatchObject({ agent: 'claude', sessionId: 's1' });
    expect(r.json().events).toEqual([
      { type: 'user_message', text: '你好' },
      { type: 'text', delta: '在' },
    ]);
    expect(api.messages).toHaveBeenCalledWith('s1', ws.localDir);
  });

  it('工作区不存在 404，会话 id 不合法 400', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'GET', url: '/api/workspaces/nope/sessions' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/workspaces/w1/sessions/a.b/events' })).statusCode).toBe(400);
    expect((await app.inject('/api/workspaces/w1/sessions?agent=unknown')).statusCode).toBe(400);
  });

  it('原生列表过滤其他工作区，历史显示最后实际模型，续接校验拒绝错误身份', async () => {
    const { app, api, sessions } = setup();
    vi.mocked(api.list).mockResolvedValueOnce([
      { sessionId: 's1', summary: '本项目', lastModified: 100, cwd: ws.localDir },
      { sessionId: 'foreign', summary: '其他项目', lastModified: 200, cwd: path.join(ws.localDir, 'other') },
    ]);
    expect((await app.inject('/api/workspaces/w1/sessions')).json()).toEqual([
      { agent: 'claude', sessionId: 's1', summary: '本项目', lastModified: 100 },
    ]);
    vi.mocked(api.messages).mockResolvedValueOnce([
      { type: 'assistant', message: { model: 'old-model', content: [] } },
      { type: 'assistant', message: { model: 'latest-model', content: [] } },
      { type: 'system', subtype: 'status' },
    ]);
    expect((await app.inject('/api/workspaces/w1/sessions/s1/events')).json().actualModel).toBe('latest-model');
    await sessions.assertBelongs(ws, 'claude', 's1');
    await expect(sessions.assertBelongs(ws, 'claude', 'wrong-id')).rejects.toMatchObject({ status: 404 });
  });

  it('共享服务复核提供方身份与目录，原生异常转换为匿名错误', async () => {
    const { sessions, codex } = setup();
    vi.mocked(codex.read).mockResolvedValueOnce({
      session: { sessionId: 'other-id', summary: '错误身份', lastModified: 100 },
      cwd: ws.localDir,
      events: [],
    });
    await expect(sessions.read(ws, 'codex', 's1')).rejects.toMatchObject({ status: 404 });
    const signal = new AbortController().signal;
    vi.mocked(codex.assertBelongs).mockRejectedValueOnce(new Error('private-runtime-detail'));
    await expect(sessions.assertBelongs(ws, 'codex', 's1', signal)).rejects.toMatchObject({
      status: 503,
      message: 'Codex 会话读取失败，请检查本机运行时与配置',
    });
    expect(codex.assertBelongs).toHaveBeenCalledWith('s1', ws.localDir, signal);
  });

  it('两类同 ID 会话独立读取，拒绝跨目录记录，单源失败不影响另一类', async () => {
    const { app, api, codex } = setup();
    const listed = await app.inject('/api/workspaces/w1/sessions?agent=codex');
    expect(listed.json()).toEqual([{ agent: 'codex', sessionId: 's1', summary: 'Codex 调参', lastModified: 200 }]);
    const history = await app.inject('/api/workspaces/w1/sessions/s1/events?agent=codex');
    expect(history.json()).toMatchObject({
      session: { agent: 'codex', sessionId: 's1' },
      actualModel: 'fixture-model',
    });
    expect(api.messages).not.toHaveBeenCalled();
    vi.mocked(api.info).mockResolvedValueOnce({
      sessionId: 's1',
      summary: '另一个目录',
      lastModified: 100,
      cwd: path.join(ws.localDir, 'other'),
    });
    expect((await app.inject('/api/workspaces/w1/sessions/s1/events')).statusCode).toBe(404);
    vi.mocked(codex.list).mockRejectedValueOnce(new Error('secret-sentinel'));
    const failed = await app.inject('/api/workspaces/w1/sessions?agent=codex');
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('secret-sentinel');
    expect(failed.headers['cache-control']).toBe('no-store');
    expect((await app.inject('/api/workspaces/w1/sessions?agent=claude')).statusCode).toBe(200);
  });
});
