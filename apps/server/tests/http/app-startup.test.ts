import { expect, it, vi } from 'vitest';
import { buildApp } from '../../src/http/app';

it('路由构造失败关闭Fastify及注册的资源，清理失败不覆盖构造错误', async () => {
  const original = new Error('synthetic route failure');
  const dispose = vi.fn(() => {
    throw new Error('synthetic cleanup failure');
  });
  await expect(
    buildApp({
      token: 'fixture',
      port: 0,
      routes: (app) => {
        app.addHook('onClose', async () => dispose());
        throw original;
      },
    }),
  ).rejects.toBe(original);
  expect(dispose).toHaveBeenCalledOnce();
});
