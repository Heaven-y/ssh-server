import { expect, it, vi } from 'vitest';
import { buildApp } from '../../src/http/app';
import { registerSessionChangesRoutes } from '../../src/http/session-changes.routes';

it('路由构造失败关闭Fastify及注册的目录监听，清理失败不覆盖构造错误', async () => {
  const original = new Error('synthetic route failure');
  const dispose = vi.fn(() => {
    throw new Error('synthetic cleanup failure');
  });
  await expect(
    buildApp({
      token: 'fixture',
      port: 0,
      routes: (app) => {
        registerSessionChangesRoutes(app, { read: () => ({ revision: 0, watching: false }), dispose });
        throw original;
      },
    }),
  ).rejects.toBe(original);
  expect(dispose).toHaveBeenCalledOnce();
});
