import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { registerLaunchEnvironmentRoutes } from '../../src/http/launch-environment.routes';
import type { LaunchEnvironment } from '../../src/settings/launch-environment';

it('启动环境路由拒绝未知来源/字段并对解析失败禁止缓存且隐藏原文', async () => {
  const app = Fastify();
  const read = vi.fn(async () => ({
    agent: 'claude',
    revision: 'missing',
    encryptionAvailable: false,
    note: '',
    variables: [],
  }));
  const save = vi.fn();
  const restart = vi.fn(async () => {
    throw new Error('internal-secret');
  });
  registerLaunchEnvironmentRoutes(app, { service: { read, save } as unknown as LaunchEnvironment, restart });
  try {
    for (const url of [
      '/api/settings/launch-environment/unknown',
      '/api/settings/launch-environment/claude?path=bad',
    ]) {
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(400);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/settings/launch-environment/claude',
      headers: { 'content-type': 'application/json' },
      payload: '{"secret-body"',
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.headers['cache-control']).toBe('no-store');
    expect(invalid.body).not.toContain('secret-body');
    const busy = await app.inject({
      method: 'POST',
      url: '/api/settings/launch-environment/claude/restart',
      payload: {},
    });
    expect(busy.statusCode).toBe(409);
    expect(busy.body).not.toContain('internal-secret');
    expect(save).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(restart).toHaveBeenCalledExactlyOnceWith('claude');
  } finally {
    await app.close();
  }
});
