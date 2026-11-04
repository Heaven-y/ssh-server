import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { createSshConsoleService } from '../../src/ssh-console/service';
import { registerSshConsoleRoutes } from '../../src/http/ssh-console.routes';
import { consoleFixture } from '../ssh-console/console.fixture';

it('独立服务器路由提供只读文件与可恢复PTY，不需要项目身份', async () => {
  const fixture = consoleFixture();
  const app = Fastify();
  const service = createSshConsoleService(fixture);
  registerSshConsoleRoutes(app, service);
  try {
    const files = await app.inject({ url: '/api/ssh-console/my-server/files' });
    expect(files.statusCode).toBe(200);
    expect(files.json()).toMatchObject({ serverId: 'my-server', path: '/home/demo' });
    const create = await app.inject({
      method: 'POST',
      url: '/api/ssh-console/my-server/terminals',
      payload: { cols: 80, rows: 24 },
    });
    expect(create.statusCode).toBe(200);
    const { id } = create.json<{ id: string }>();
    const read = await app.inject({ url: `/api/ssh-console/my-server/terminals/${id}?fromSeq=0` });
    expect(read.json()).toMatchObject({ id, data: '', nextSeq: 0, reset: false });
    expect(read.headers['cache-control']).toBe('no-store');
    const input = await app.inject({
      method: 'POST',
      url: `/api/ssh-console/my-server/terminals/${id}/input`,
      payload: { data: 'YQ==' },
    });
    expect(input.json()).toEqual({ written: 1 });
    const wrongServer = await app.inject({ method: 'DELETE', url: `/api/ssh-console/other-server/terminals/${id}` });
    expect(wrongServer.statusCode).toBe(404);
    const closed = await app.inject({ method: 'DELETE', url: `/api/ssh-console/my-server/terminals/${id}` });
    expect(closed.statusCode).toBe(204);
    expect(fixture.pool.disconnect).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

it('未知字段、无效游标、JSON解析失败和插件停用统一拒绝且不回传输入', async () => {
  const fixture = consoleFixture();
  const app = Fastify();
  registerSshConsoleRoutes(app, createSshConsoleService(fixture));
  try {
    for (const url of [
      '/api/ssh-console/my-server/files?workspaceId=other',
      '/api/ssh-console/my-server/preview',
      '/api/ssh-console/my-server/terminals/bad?fromSeq=-1',
    ]) {
      const result = await app.inject({ url });
      expect(result.statusCode).toBe(400);
      expect(result.headers['cache-control']).toBe('no-store');
    }
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/ssh-console/my-server/terminals',
      headers: { 'content-type': 'application/json' },
      payload: '{"private-value"',
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).not.toContain('private-value');
    expect(invalid.headers['cache-control']).toBe('no-store');
    fixture.disable();
    const disabled = await app.inject({ url: '/api/ssh-console/my-server/terminals' });
    expect(disabled.statusCode).toBe(403);
    expect(disabled.json()).toMatchObject({ code: 'plugin_disabled' });
  } finally {
    await app.close();
  }
});
