import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { WorkbenchPluginIdSchema } from '@agentdeck/shared/plugins';
import { WorkbenchPluginError, pluginError } from '../plugins/errors';
import { MAX_PLUGIN_STORAGE_BYTES } from '../plugins/files';
import type { WorkbenchPluginsService } from '../plugins/service';
import { PluginStorageValueSchema } from '../plugins/storage';

export type PluginRoutesDeps = { service: WorkbenchPluginsService };
const Query = z.object({}).strict();
const Params = z.object({ id: WorkbenchPluginIdSchema }).strict();
const Revision = z.string().regex(/^(?:missing|[a-f0-9]{64})$/);
const InstallBody = z.object({ directory: z.string().min(1).max(4096) }).strict();
const UpdateBody = z.object({ enabled: z.boolean(), revision: Revision }).strict();
const RemoveBody = z.object({ revision: Revision }).strict();
const StorageBody = z.object({ value: PluginStorageValueSchema, revision: Revision }).strict();

function pluginId(req: FastifyRequest) {
  const params = Params.safeParse(req.params);
  if (!params.success) throw new WorkbenchPluginError('invalid_request');
  return params.data.id;
}
function bodyOf<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new WorkbenchPluginError('invalid_request');
  return parsed.data;
}
async function respond(req: FastifyRequest, reply: FastifyReply, operation: () => Promise<unknown>) {
  reply.header('Cache-Control', 'no-store');
  try {
    if (!Query.safeParse(req.query).success) throw new WorkbenchPluginError('invalid_request');
    return await operation();
  } catch (error) {
    const failure = pluginError(error);
    return reply.code(failure.status).send({ code: failure.code, message: failure.message });
  }
}

export function registerPluginRoutes(app: FastifyInstance, { service }: PluginRoutesDeps): void {
  const options: RouteShorthandOptions = {
    bodyLimit: MAX_PLUGIN_STORAGE_BYTES * 6 + 512,
    onSend: async (_req, reply, payload) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      return payload;
    },
    errorHandler: (error, _req, reply) => {
      const failure = new WorkbenchPluginError(error.statusCode === 413 ? 'too_large' : 'invalid_request');
      void reply.code(failure.status).send({ code: failure.code, message: failure.message });
    },
  };
  app.get('/api/plugins', options, (req, reply) => respond(req, reply, () => service.list()));
  app.post('/api/plugins/install', options, (req, reply) =>
    respond(req, reply, async () => {
      const catalog = await service.install(bodyOf(InstallBody, req.body));
      reply.code(201);
      return catalog;
    }),
  );
  app.put('/api/plugins/:id', options, (req, reply) =>
    respond(req, reply, () => service.update(pluginId(req), bodyOf(UpdateBody, req.body))),
  );
  app.delete('/api/plugins/:id', options, (req, reply) =>
    respond(req, reply, () => service.remove(pluginId(req), bodyOf(RemoveBody, req.body))),
  );
  // 入口始终返回 JSON，由已鉴权宿主创建 srcDoc；不放宽全局 CSP 或会话来源检查。
  app.get('/api/plugins/:id/page', options, (req, reply) => respond(req, reply, () => service.page(pluginId(req))));
  app.get('/api/plugins/:id/storage', options, (req, reply) =>
    respond(req, reply, () => service.readStorage(pluginId(req))),
  );
  app.put('/api/plugins/:id/storage', options, (req, reply) =>
    respond(req, reply, () => service.saveStorage(pluginId(req), bodyOf(StorageBody, req.body))),
  );
}
