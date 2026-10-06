import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '@ssh-server/shared';
import type { WorkspaceStore } from '../../src/workspaces/store';
import type { WorkspaceSetup } from '../../src/workspaces/setup/service';
import { WorkspaceSetupError } from '../../src/workspaces/setup/errors';
import { WorkspaceRemovalError } from '../../src/workspaces/activity';
import { registerWorkspaceRoutes, type WorkspaceRoutesDeps } from '../../src/http/workspaces.routes';

const WS: Workspace = {
  id: 'w1',
  name: 'demo',
  localDir: path.join(os.tmpdir(), 'ssh-server-fixture', 'demo'),
  sshHost: 'my-server',
  remoteDir: '~',
};
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(services: Partial<Pick<WorkspaceRoutesDeps, 'setup' | 'removal'>> = {}) {
  const list: Workspace[] = [{ ...WS }];
  const store: WorkspaceStore = {
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
  registerWorkspaceRoutes(app, {
    store,
    listSshHosts: async () => [{ alias: 'my-server', unsupported: [] }],
    ...services,
  });
  return { app, store };
}
const { id: _id, ...body } = WS;
const verified = {
  input: body,
  verification: '11111111-1111-4111-8111-111111111111',
  initializationConfirmed: true,
};
const confirmed = { configuration: 'a'.repeat(64), confirmed: true };

function setupService() {
  const create = vi.fn(async () => ({ workspace: WS }));
  return { create, service: { create } as unknown as WorkspaceSetup };
}
function removalService() {
  return {
    preview: vi.fn(async () => ({ workspace: WS, configuration: confirmed.configuration, blockers: [] })),
    remove: vi.fn(async () => ({ removed: true as const })),
  };
}

describe('工作区接口', () => {
  it('列表与 ssh-hosts', async () => {
    const { app } = setup();
    expect((await app.inject('/api/workspaces')).json()).toEqual([WS]);
    expect((await app.inject('/api/ssh-hosts')).json()).toEqual([{ alias: 'my-server', unsupported: [] }]);
  });

  it('缺少创建或移除服务时明确503，不退回存储写入', async () => {
    const { app, store } = setup();
    for (const payload of [body, verified])
      expect((await app.inject({ method: 'POST', url: '/api/workspaces', payload })).statusCode).toBe(503);
    for (const payload of [undefined, confirmed])
      expect((await app.inject({ method: 'DELETE', url: '/api/workspaces/w1', payload })).statusCode).toBe(503);
    expect((await app.inject('/api/workspaces/w1/removal')).statusCode).toBe(503);
    expect(store.create).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([WS]);
  });

  it('旧POST无票据或无首次同步确认均拒绝，只将完整请求交给向导', async () => {
    const service = setupService();
    const { app, store } = setup({ setup: service.service });
    for (const payload of [body, { input: body }, { ...verified, initializationConfirmed: false }]) {
      const response = await app.inject({ method: 'POST', url: '/api/workspaces', payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'setup_verification_required' });
    }
    expect(service.create).not.toHaveBeenCalled();
    const response = await app.inject({ method: 'POST', url: '/api/workspaces', payload: verified });
    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledExactlyOnceWith(verified, expect.any(AbortSignal));
    service.create.mockRejectedValueOnce(new WorkspaceSetupError('verification_expired', '请重新验证'));
    expect((await app.inject({ method: 'POST', url: '/api/workspaces', payload: verified })).statusCode).toBe(409);
    expect(store.create).not.toHaveBeenCalled();
  });

  it('通用PATCH始终404且配置不变', async () => {
    const { app, store } = setup();
    for (const payload of [{ name: '改名' }, { policy: {} }, { sync: { maxFileBytes: 1 } }])
      expect((await app.inject({ method: 'PATCH', url: '/api/workspaces/w1', payload })).statusCode).toBe(404);
    expect(store.update).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([WS]);
  });

  it('DELETE没有确认拒绝，只将完整确认交给移除服务', async () => {
    const removal = removalService();
    const { app, store } = setup({ removal });
    for (const payload of [undefined, { confirmed: true }, { ...confirmed, confirmed: false }]) {
      const response = await app.inject({ method: 'DELETE', url: '/api/workspaces/w1', payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'workspace_confirmation_required' });
    }
    expect(removal.remove).not.toHaveBeenCalled();
    expect((await app.inject('/api/workspaces/w1/removal')).json()).toMatchObject({ workspace: WS });
    const response = await app.inject({ method: 'DELETE', url: '/api/workspaces/w1', payload: confirmed });
    expect(response.json()).toEqual({ removed: true });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(removal.remove).toHaveBeenCalledExactlyOnceWith('w1', confirmed);
    removal.remove.mockRejectedValueOnce(new WorkspaceRemovalError('workspace_busy', '工作区正在使用'));
    expect((await app.inject({ method: 'DELETE', url: '/api/workspaces/w1', payload: confirmed })).statusCode).toBe(
      409,
    );
    expect(store.remove).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([WS]);
  });
});
