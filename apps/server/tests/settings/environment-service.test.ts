import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import type { EnvironmentReport } from '@ssh-server/shared';
import { createEnvironmentService } from '../../src/settings/environment';
import { createProductSettings } from '../../src/settings/product-settings';
import { registerProductSettingsRoutes } from '../../src/http/product-settings.routes';

it('启动一次探测，GET复用报告，手动POST刷新同一份结果', async () => {
  let tick = 0;
  const detect = vi.fn(async (): Promise<EnvironmentReport> => ({ checkedAt: ++tick, tools: [] }));
  const environment = createEnvironmentService(detect);
  expect((await environment.read()).checkedAt).toBe(1);
  const app = Fastify();
  registerProductSettingsRoutes(app, createProductSettings({ configDir: 'unused-test-config' }), environment);
  try {
    for (let i = 0; i < 2; i++) {
      const response = await app.inject({ url: '/api/settings/environment' });
      expect(response.statusCode).toBe(200);
      expect(response.json().checkedAt).toBe(1);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(detect).toHaveBeenCalledTimes(1);
    const refresh = await app.inject({ method: 'POST', url: '/api/settings/environment', payload: {} });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().checkedAt).toBe(2);
    expect((await app.inject({ url: '/api/settings/environment' })).json().checkedAt).toBe(2);
    expect(detect).toHaveBeenCalledTimes(2);
    expect((await app.inject({ url: '/api/settings/environment?path=x' })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: '/api/settings/environment', payload: { install: true } })).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});

it('并发读取共享启动检测；刷新中的第二个请求被拒绝而不启动额外进程', async () => {
  let finish!: (value: EnvironmentReport) => void;
  const detect = vi.fn(
    () =>
      new Promise<EnvironmentReport>((resolve) => {
        finish = resolve;
      }),
  );
  const service = createEnvironmentService(detect);
  const reads = [service.read(), service.read()];
  await expect(service.refresh()).rejects.toMatchObject({ status: 409 });
  finish({ checkedAt: 1, tools: [] });
  expect(await Promise.all(reads)).toEqual([
    { checkedAt: 1, tools: [] },
    { checkedAt: 1, tools: [] },
  ]);
  expect(detect).toHaveBeenCalledTimes(1);
  const refresh = service.refresh();
  await expect(service.refresh()).rejects.toMatchObject({ status: 409 });
  finish({ checkedAt: 2, tools: [] });
  expect(await refresh).toEqual({ checkedAt: 2, tools: [] });
});
