import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace, WorkspaceFile } from '@ssh-server/shared';
import { WorkspaceFileError } from '../../src/files/errors';
import type { WorkspaceFilesService } from '../../src/files/service';
import { registerFileRoutes } from '../../src/http/files.routes';
import { createSyncManager } from '../../src/sync/manager';

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
const file: WorkspaceFile = { path: 'main.py', content: 'print(1)\n', revision: 'a'.repeat(64), size: 9 };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const app = Fastify();
  apps.push(app);
  const files: WorkspaceFilesService = {
    list: vi.fn(async () => ({ path: '', entries: [], truncated: false })),
    read: vi.fn(async () => file),
    revision: vi.fn(async () => ({ revision: file.revision })),
    save: vi.fn(async () => file),
  };
  const store = { get: vi.fn(async (id: string) => (id === ws.id ? ws : undefined)) };
  const driver = {
    open: vi.fn(async () => {
      throw new Error('本地保存不应连接远端');
    }),
  };
  const sync = createSyncManager({ configDir: path.join(ws.localDir, 'state'), driver });
  registerFileRoutes(app, { store, files, sync });
  const put = () =>
    app.inject({
      method: 'PUT',
      url: '/api/workspaces/w1/file',
      payload: { path: file.path, content: file.content, revision: file.revision },
    });
  return { app, store, files, sync, driver, put };
}

describe('工作区文件接口', () => {
  it('读取目录、文件和版本均受工作区限制并禁止缓存', async () => {
    const { app, files } = setup();
    const responses = await Promise.all([
      app.inject('/api/workspaces/w1/files'),
      app.inject('/api/workspaces/w1/file?path=main.py'),
      app.inject('/api/workspaces/w1/file/revision?path=main.py'),
    ]);
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(files.list).toHaveBeenCalledWith(ws, '');
    expect(files.read).toHaveBeenCalledWith(ws, 'main.py');
    expect(responses[2].json()).toEqual({ revision: file.revision });
    expect((await app.inject('/api/workspaces/missing/file?path=main.py')).statusCode).toBe(404);
    expect((await app.inject('/api/workspaces/w1/files?other=unused')).statusCode).toBe(400);
  });

  it('PUT 等待同步事务释放，仅返回本地保存结果，不自行连接远端', async () => {
    const { files, sync, driver, put } = setup();
    const entered = deferred();
    const release = deferred();
    const transaction = vi.spyOn(sync, 'transaction');
    const active = sync.transaction(ws, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const pending = put().then((response) => response);
    await vi.waitFor(() => expect(transaction).toHaveBeenCalledTimes(2));
    expect(files.save).not.toHaveBeenCalled();
    release.resolve();
    await active;
    const saved = await pending;
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual(file);
    expect(saved.headers['cache-control']).toBe('no-store');
    expect(files.save).toHaveBeenCalledWith(ws, { path: file.path, content: file.content, revision: file.revision });
    expect(driver.open).not.toHaveBeenCalled();
  });

  it('排队后重新核对工作区根目录，变更时不写入其他目录', async () => {
    const { store, files, put } = setup();
    store.get.mockResolvedValueOnce(ws).mockResolvedValueOnce({ ...ws, localDir: path.join(ws.localDir, 'changed') });
    const response = await put();
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'revision_conflict' });
    expect(files.save).not.toHaveBeenCalled();
  });

  it('非法请求、保存冲突、系统和 JSON 解析错误均安全返回', async () => {
    const { app, files, put } = setup();
    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/workspaces/w1/file',
      payload: { path: 'main.py', content: 'text', revision: 'missing', absolutePath: 'other' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(files.save).not.toHaveBeenCalled();
    vi.mocked(files.save).mockRejectedValueOnce(new WorkspaceFileError('revision_conflict'));
    expect((await put()).statusCode).toBe(409);
    vi.mocked(files.read).mockRejectedValueOnce(new Error('secret-sentinel'));
    const failed = await app.inject('/api/workspaces/w1/file?path=main.py');
    expect(failed.statusCode).toBe(500);
    const malformed = await app.inject({
      method: 'PUT',
      url: '/api/workspaces/w1/file',
      headers: { 'content-type': 'application/json' },
      payload: '{"secret-sentinel": broken}',
    });
    expect(malformed.statusCode).toBe(400);
    for (const response of [failed, malformed]) {
      expect(response.body).not.toContain('secret-sentinel');
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });
});
