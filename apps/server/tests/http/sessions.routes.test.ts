import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '@ssh-server/shared';
import type { WorkspaceStore } from '../../src/workspaces/store';
import { registerSessionRoutes, type SessionsApi } from '../../src/http/sessions.routes';

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
  const api: SessionsApi = {
    list: vi.fn(async () => [{ sessionId: 's1', summary: '调参', lastModified: 100, fileSize: 9 }]),
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
  registerSessionRoutes(app, { store, api });
  return { app, api };
}

describe('会话接口', () => {
  it('列出工作区本地文件夹下的会话', async () => {
    const { app, api } = setup();
    const r = await app.inject({ method: 'GET', url: '/api/workspaces/w1/sessions' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([{ sessionId: 's1', summary: '调参', lastModified: 100 }]);
    expect(api.list).toHaveBeenCalledWith(ws.localDir);
  });

  it('返回会话历史对应的事件', async () => {
    const { app, api } = setup();
    const r = await app.inject({ method: 'GET', url: '/api/workspaces/w1/sessions/s1/events' });
    expect(r.json()).toEqual([
      { type: 'user_message', text: '你好' },
      { type: 'text', delta: '在' },
    ]);
    expect(api.messages).toHaveBeenCalledWith('s1', ws.localDir);
  });

  it('工作区不存在 404，会话 id 不合法 400', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'GET', url: '/api/workspaces/nope/sessions' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/workspaces/w1/sessions/a.b/events' })).statusCode).toBe(400);
  });
});
