import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '@agentdeck/shared';
import type { WorkspaceStore } from '../../src/workspaces/store';
import { registerWorkspaceRoutes } from '../../src/http/workspaces.routes';

const WS: Workspace = {
  id: 'w1',
  name: 'demo',
  dir: path.join(os.tmpdir(), 'agentdeck-fixture', 'demo'),
  server: 'my-server',
  remoteDir: '~',
};
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup() {
  const list: Workspace[] = [{ ...WS }];
  const store: WorkspaceStore = {
    withSnapshot: async (operation) => operation(list),
    list: async () => list,
    get: async (id) => list.find((workspace) => workspace.id === id),
    create: vi.fn<WorkspaceStore['create']>(async (input) => {
      const workspace = { ...input, id: 'w2' };
      list.push(workspace);
      return workspace;
    }),
    update: vi.fn<WorkspaceStore['update']>(async (id, patch) => {
      const workspace = list.find((entry) => entry.id === id);
      return workspace && Object.assign(workspace, patch);
    }),
    remove: vi.fn(async (id) => {
      const index = list.findIndex((workspace) => workspace.id === id);
      if (index === -1) return false;
      list.splice(index, 1);
      return true;
    }),
  };
  const app = Fastify();
  apps.push(app);
  registerWorkspaceRoutes(app, { store });
  return { app, store };
}
const { id: _id, ...body } = WS;

describe('工作区接口', () => {
  it('工作区列表可用，旧ssh-hosts入口不存在', async () => {
    const { app } = setup();
    expect((await app.inject('/api/workspaces')).json()).toEqual([WS]);
    expect((await app.inject('/api/ssh-hosts')).statusCode).toBe(404);
  });

  it('创建与移除接口随双端向导一起删除，不退回存储写入', async () => {
    const { app, store } = setup();
    expect((await app.inject({ method: 'POST', url: '/api/workspaces', payload: body })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/workspaces/w1', payload: {} })).statusCode).toBe(404);
    expect((await app.inject('/api/workspaces/w1/removal')).statusCode).toBe(404);
    expect(store.create).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([WS]);
  });

  it('通用PATCH始终404且配置不变', async () => {
    const { app, store } = setup();
    for (const payload of [{ name: '改名' }, { remoteDir: '/srv/demo' }, { sync: { maxFileBytes: 1 } }])
      expect((await app.inject({ method: 'PATCH', url: '/api/workspaces/w1', payload })).statusCode).toBe(404);
    expect(store.update).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([WS]);
  });
});
