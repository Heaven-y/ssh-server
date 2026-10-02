import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncSettingsSchema, type Workspace } from '@ssh-server/shared';
import { registerSyncRoutes } from './sync.routes';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const ws: Workspace = { id: 'w1', name: 'demo', localDir: 'D:/w', sshHost: 'my-server', remoteDir: '~/projects/demo' };
function setup() {
  const status = { phase: 'ready' as const, conflicts: [], deletions: [], settings: SyncSettingsSchema.parse({}) };
  const sync = {
    status: vi.fn(async () => status),
    sync: vi.fn(async () => status),
    initialize: vi.fn(async () => status),
    resolveDeletions: vi.fn(async () => status),
    acknowledgeConflicts: vi.fn(async () => status),
    transaction: async <T>(_ws: Workspace, fn: () => Promise<T>) => fn(),
  };
  const store = {
    get: async (id: string) => (id === 'w1' ? ws : undefined),
    update: vi.fn(async (_id: string, patch: Partial<Workspace>) => ({ ...ws, ...patch })),
  };
  const app = Fastify();
  apps.push(app);
  registerSyncRoutes(app, { store, sync });
  const post = (suffix: string, payload: unknown = {}) =>
    app.inject({ method: 'POST', url: `/api/workspaces/w1/sync${suffix}`, payload: payload as object });
  return { app, sync, store, post };
}
describe('网页同步与决策接口', () => {
  it('读取状态无传输，未知工作区 404', async () => {
    const { app, sync } = setup();
    expect((await app.inject('/api/workspaces/w1/sync')).json()).toMatchObject({ phase: 'ready' });
    expect((await app.inject('/api/workspaces/missing/sync')).statusCode).toBe(404);
    expect(sync.sync).not.toHaveBeenCalled();
  });
  it('初始化与删除需要明确有效决策，非法输入不执行', async () => {
    const { post, sync } = setup();
    expect((await post('/initialize', {})).statusCode).toBe(400);
    expect((await post('/deletions', { decision: 'force' })).statusCode).toBe(400);
    expect(sync.initialize).not.toHaveBeenCalled();
    expect(sync.resolveDeletions).not.toHaveBeenCalled();
    expect((await post('/initialize', { confirmed: true })).statusCode).toBe(200);
    expect(sync.initialize).toHaveBeenCalledWith(ws, true);
    await post('/deletions', { decision: 'reject' });
    expect(sync.resolveDeletions).toHaveBeenCalledWith(ws, 'reject');
  });
  it('手动同步与冲突确认分开，设置仅持久化规则', async () => {
    const { post, sync, store } = setup();
    await post('');
    await post('/conflicts/ack');
    expect(sync.sync).toHaveBeenCalledTimes(1);
    expect(sync.acknowledgeConflicts).toHaveBeenCalledWith(ws);
    expect(
      (await post('/settings', { maxFileBytes: 100, excludedExtensions: ['PT'], password: 'never-store' })).statusCode,
    ).toBe(200);
    expect(store.update).toHaveBeenCalledWith('w1', { sync: { maxFileBytes: 100, excludedExtensions: ['pt'] } });
    expect(JSON.stringify(store.update.mock.calls)).not.toContain('never-store');
  });
});
