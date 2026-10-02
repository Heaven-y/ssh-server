import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VersionStatus, Workspace } from '@ssh-server/shared';
import { registerVersionRoutes } from '../../src/http/versions.routes';
import { VersionError } from '../../src/vcs/errors';
import type { VersionsService } from '../../src/vcs/service';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const commit = 'a'.repeat(40);
const revision = 'b'.repeat(64);
const ws: Workspace = {
  id: 'w1',
  name: 'demo',
  localDir: path.join(os.tmpdir(), 'version-route-fixture'),
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
};
const status: VersionStatus = { initialized: true, head: commit, revision, changes: [], excluded: [] };

function setup() {
  const app = Fastify();
  apps.push(app);
  const versions: VersionsService = {
    initialize: vi.fn(async () => status),
    status: vi.fn(async () => status),
    history: vi.fn(async () => ({ commits: [], hasMore: false })),
    diff: vi.fn(async () => ({ text: '', files: [], truncated: false })),
    save: vi.fn(async () => ({ created: false, commit: undefined, status })),
    previewRestore: vi.fn(async () => ({ commit, revision, changes: [], excluded: [] })),
    restore: vi.fn(async () => ({ restored: ['main.py'], status })),
  };
  const store = { get: vi.fn(async (id: string) => (id === ws.id ? ws : undefined)) };
  const sync = { transaction: async <T>(_ws: Workspace, operation: () => Promise<T>): Promise<T> => operation() };
  vi.spyOn(sync, 'transaction');
  registerVersionRoutes(app, { store, versions, sync });
  return { app, versions, store, sync };
}

describe('版本记录接口', () => {
  it('读取转发固定字段且禁止缓存，写操作复用同步事务', async () => {
    const { app, versions, sync } = setup();
    const responses = await Promise.all([
      app.inject('/api/workspaces/w1/versions'),
      app.inject('/api/workspaces/w1/versions/history?skip=30'),
      app.inject(`/api/workspaces/w1/versions/diff?commit=${commit}&path=main.py`),
      app.inject({
        method: 'POST',
        url: '/api/workspaces/w1/versions/restore/preview',
        payload: { commit, path: 'main.py' },
      }),
    ]);
    expect(versions.history).toHaveBeenCalledWith(ws, 30);
    expect(versions.diff).toHaveBeenCalledWith(ws, { commit, path: 'main.py' });
    expect(sync.transaction).not.toHaveBeenCalled();
    for (const [suffix, payload] of [
      ['initialize', {}],
      ['save', { message: ' 保存说明 ', revision }],
      ['restore', { commit, revision, confirmed: true }],
    ] as const) {
      responses.push(await app.inject({ method: 'POST', url: `/api/workspaces/w1/versions/${suffix}`, payload }));
    }
    expect(sync.transaction).toHaveBeenCalledTimes(3);
    expect(versions.save).toHaveBeenCalledWith(ws, { message: '保存说明', revision });
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('拒绝未确认恢复、任意提交表达式、额外字段和超长说明', async () => {
    const { app, versions } = setup();
    const requests = [
      { method: 'POST' as const, url: '/api/workspaces/w1/versions/restore', payload: { commit, revision } },
      {
        method: 'POST' as const,
        url: '/api/workspaces/w1/versions/save',
        payload: { message: 'x'.repeat(201), revision },
      },
      {
        method: 'POST' as const,
        url: '/api/workspaces/w1/versions/save',
        payload: { message: '说明', revision, args: ['push'] },
      },
      { method: 'GET' as const, url: '/api/workspaces/w1/versions/diff?commit=HEAD' },
      { method: 'GET' as const, url: '/api/workspaces/w1/versions/history?skip=-1' },
    ];
    for (const request of requests) expect((await app.inject(request)).statusCode).toBe(400);
    expect(versions.restore).not.toHaveBeenCalled();
    expect(versions.save).not.toHaveBeenCalled();
    expect((await app.inject('/api/workspaces/missing/versions')).statusCode).toBe(404);
  });

  it('系统和 JSON 解析错误匿名返回，部分恢复错误保留相对受影响范围', async () => {
    const { app, versions } = setup();
    vi.mocked(versions.status).mockRejectedValueOnce(new Error('secret-sentinel'));
    const failed = await app.inject('/api/workspaces/w1/versions');
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/workspaces/w1/versions/save',
      headers: { 'content-type': 'application/json' },
      payload: '{"secret-sentinel":invalid}',
    });
    for (const response of [failed, malformed]) {
      expect(response.body).not.toContain('secret-sentinel');
      expect(response.headers['cache-control']).toBe('no-store');
    }
    vi.mocked(versions.restore).mockRejectedValueOnce(new VersionError('partial_restore', ['main.py']));
    const partial = await app.inject({
      method: 'POST',
      url: '/api/workspaces/w1/versions/restore',
      payload: { commit, revision, confirmed: true },
    });
    expect(partial.statusCode).toBe(500);
    expect(partial.json()).toMatchObject({ code: 'partial_restore', affectedPaths: ['main.py'] });
  });
});
