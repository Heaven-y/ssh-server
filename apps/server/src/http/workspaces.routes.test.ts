import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Workspace } from '@ssh-server/shared';
import { WorkspaceValidationError, type WorkspaceStore } from '../workspaces/store';
import { registerWorkspaceRoutes } from './workspaces.routes';

const WS: Workspace = { id: 'w1', name: 'demo', localDir: 'E:\\work\\demo', sshHost: 'my-server', remoteDir: '~' };

/** 内存版 store：create/update 遇到 name 为 bad 时抛校验错误 */
function fakeStore(): WorkspaceStore {
  const list: Workspace[] = [WS];
  const check = (name?: string) => {
    if (name === 'bad') throw new WorkspaceValidationError('name', '名称不合法');
  };
  return {
    list: async () => list,
    get: async (id) => list.find((w) => w.id === id),
    create: async (input) => {
      check(input.name);
      const ws = { ...input, id: 'w2' };
      list.push(ws);
      return ws;
    },
    update: async (id, patch) => {
      check(patch.name);
      const ws = list.find((w) => w.id === id);
      return ws && Object.assign(ws, patch);
    },
    remove: async (id) => {
      const idx = list.findIndex((w) => w.id === id);
      if (idx === -1) return false;
      list.splice(idx, 1);
      return true;
    },
  };
}

function setup() {
  const app = Fastify();
  registerWorkspaceRoutes(app, {
    store: fakeStore(),
    listSshHosts: async () => [{ alias: 'my-server', unsupported: [] }],
  });
  return app;
}

const body = { name: 'n', localDir: 'E:\\x', sshHost: 'my-server', remoteDir: '~' };

describe('工作区接口', () => {
  it('列表与 ssh-hosts', async () => {
    const app = setup();
    expect((await app.inject({ method: 'GET', url: '/api/workspaces' })).json()).toEqual([WS]);
    expect((await app.inject({ method: 'GET', url: '/api/ssh-hosts' })).json()).toEqual([
      { alias: 'my-server', unsupported: [] },
    ]);
  });

  it('创建成功 201，校验失败 400 并带字段名', async () => {
    const app = setup();
    const ok = await app.inject({ method: 'POST', url: '/api/workspaces', payload: body });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ id: 'w2' });
    const bad = await app.inject({ method: 'POST', url: '/api/workspaces', payload: { ...body, name: 'bad' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ field: 'name', message: '名称不合法' });
  });

  it('更新：存在返回新值，不存在 404，校验失败 400', async () => {
    const app = setup();
    const ok = await app.inject({ method: 'PATCH', url: '/api/workspaces/w1', payload: { name: 'x' } });
    expect(ok.json()).toMatchObject({ id: 'w1', name: 'x' });
    const missing = await app.inject({ method: 'PATCH', url: '/api/workspaces/nope', payload: { name: 'x' } });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({ method: 'PATCH', url: '/api/workspaces/w1', payload: { name: 'bad' } });
    expect(bad.statusCode).toBe(400);
  });

  it('删除：存在 204，不存在 404', async () => {
    const app = setup();
    expect((await app.inject({ method: 'DELETE', url: '/api/workspaces/w1' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: '/api/workspaces/w1' })).statusCode).toBe(404);
  });
});
