import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { registerSessionChangesRoutes } from '../../src/http/session-changes.routes';

it('会话变化接口只返回轻量版本、不接受路径参数且关闭时清理监听', async () => {
  const app = Fastify();
  const service = { read: vi.fn(() => ({ revision: 12, watching: true })), dispose: vi.fn() };
  registerSessionChangesRoutes(app, service);
  try {
    const result = await app.inject({ url: '/api/session-changes' });
    expect(result.statusCode).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.json()).toEqual({ revision: 12, watching: true });
    const invalid = await app.inject({ url: '/api/session-changes?path=private-value' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).not.toContain('private-value');
    expect(invalid.headers['cache-control']).toBe('no-store');
    expect(service.read).toHaveBeenCalledOnce();
  } finally {
    await app.close();
  }
  expect(service.dispose).toHaveBeenCalledOnce();
});
