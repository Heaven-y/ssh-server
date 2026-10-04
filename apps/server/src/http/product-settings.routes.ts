import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ProductSettingsInputSchema } from '@ssh-server/shared';
import { ProductSettingsError, type ProductSettingsStore } from '../settings/product-settings';
import { anonymousConfigError } from '../settings/errors';
import { detectEnvironment } from '../settings/environment';
import { requestSignal } from './remote-files.routes';

const Empty = z.strictObject({});
async function respond(reply: FastifyReply, operation: () => Promise<unknown>) {
  reply.header('Cache-Control', 'no-store');
  try {
    return await operation();
  } catch (error) {
    const failure = error instanceof ProductSettingsError ? error : anonymousConfigError(error);
    return reply.code(failure.status).send({ code: failure.code, message: failure.message });
  }
}
export function registerProductSettingsRoutes(app: FastifyInstance, settings: ProductSettingsStore) {
  app.get('/api/settings/product', (request, reply) =>
    respond(reply, async () => {
      if (!Empty.safeParse(request.query).success)
        throw new ProductSettingsError('invalid_request', 400, '产品设置请求格式不正确');
      return settings.read();
    }),
  );
  app.put('/api/settings/product', { bodyLimit: 16384 }, (request, reply) =>
    respond(reply, async () => {
      const input = ProductSettingsInputSchema.safeParse(request.body);
      if (!input.success || !Empty.safeParse(request.query).success)
        throw new ProductSettingsError('invalid_request', 400, '请检查产品设置字段及数值范围');
      return settings.save(input.data);
    }),
  );
  let detecting = false;
  app.post('/api/settings/environment', { bodyLimit: 1024 }, (request, reply) =>
    respond(reply, async () => {
      if (!Empty.safeParse(request.body).success || !Empty.safeParse(request.query).success)
        throw new ProductSettingsError('invalid_request', 400, '环境检测请求格式不正确');
      if (detecting) throw new ProductSettingsError('invalid_request', 409, '环境检测正在进行，请等待完成');
      detecting = true;
      try {
        return await detectEnvironment({ signal: requestSignal(request, reply) });
      } finally {
        detecting = false;
      }
    }),
  );
}
