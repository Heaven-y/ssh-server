import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace, WorkspaceFile } from '@ssh-server/shared';
import type { WorkspaceFilesService } from '../../src/files/service';
import { registerFileRoutes } from '../../src/http/files.routes';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const ws: Workspace = {
  id: 'w1',
  name: 'demo',
  localDir: path.join(os.tmpdir(), 'file-route-fixture'),
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
};
const file: WorkspaceFile = { path: 'main.py', content: 'print(1)\n', size: 9 };
function setup() {
  const app = Fastify();
  apps.push(app);
  const files: WorkspaceFilesService = {
    list: vi.fn(async () => ({ path: '', entries: [], truncated: false })),
    read: vi.fn(async () => file),
  };
  const store = { get: vi.fn(async (id: string) => (id === ws.id ? ws : undefined)) };
  registerFileRoutes(app, { store, files });
  return { app, store, files };
}

describe('工作区文件接口（只读）', () => {
  it('目录与文件读取受工作区限制并禁止缓存', async () => {
    const { app, files } = setup();
    const responses = await Promise.all([
      app.inject('/api/workspaces/w1/files'),
      app.inject('/api/workspaces/w1/file?path=main.py'),
    ]);
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(files.list).toHaveBeenCalledWith(ws, '');
    expect(files.read).toHaveBeenCalledWith(ws, 'main.py');
    expect(responses[1].json()).toEqual(file);
    expect((await app.inject('/api/workspaces/missing/file?path=main.py')).statusCode).toBe(404);
    expect((await app.inject('/api/workspaces/w1/files?other=unused')).statusCode).toBe(400);
  });

  it('不提供写入：PUT 与 revision 查询都没有路由', async () => {
    const { app, files } = setup();
    const put = await app.inject({ method: 'PUT', url: '/api/workspaces/w1/file', payload: { path: 'main.py' } });
    expect(put.statusCode).toBe(404);
    expect((await app.inject('/api/workspaces/w1/file/revision?path=main.py')).statusCode).toBe(404);
    expect(files.read).not.toHaveBeenCalled();
  });

  it('底层读取失败匿名返回，且仍禁止缓存', async () => {
    const { app, files } = setup();
    vi.mocked(files.read).mockRejectedValueOnce(new Error('secret-sentinel'));
    const failed = await app.inject('/api/workspaces/w1/file?path=main.py');
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain('secret-sentinel');
    expect(failed.headers['cache-control']).toBe('no-store');
  });
});
