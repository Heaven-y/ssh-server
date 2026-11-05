import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { registerModelSettingsRoutes } from '../../src/http/model-settings.routes';

it('模型配置拒绝路径参数和未知请求体，响应不缓存且解析错误不泄漏正文', async () => {
  const app = Fastify();
  const read = vi.fn();
  const save = vi.fn();
  registerModelSettingsRoutes(app, { read, save });
  try {
    for (const url of ['/api/settings/models/unknown', '/api/settings/models/codex?path=elsewhere']) {
      const result = await app.inject({ url });
      expect(result.statusCode).toBe(400);
      expect(result.headers['cache-control']).toBe('no-store');
    }
    for (const payload of ['{"secret-body"', '{"revision":"missing","changes":{},"path":"secret-path"}']) {
      const result = await app.inject({
        method: 'PUT',
        url: '/api/settings/models/codex',
        headers: { 'content-type': 'application/json' },
        payload,
      });
      expect(result.statusCode).toBe(400);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body).not.toContain('secret-');
    }
    expect(read).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
