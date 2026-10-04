import type { FastifyInstance, FastifyReply } from 'fastify';
import { ServerTargetsError, type ServerTargets } from '../ssh/targets';

async function respond(reply: FastifyReply, operation: () => Promise<unknown>) {
  reply.header('Cache-Control', 'no-store');
  try {
    return await operation();
  } catch (error) {
    const failure = error instanceof ServerTargetsError ? error : new ServerTargetsError('target_storage_failed');
    return reply
      .code(failure.code === 'invalid_target' ? 400 : failure.code === 'too_many_targets' ? 409 : 500)
      .send({ code: failure.code, message: failure.message });
  }
}
export function registerSshTargetRoutes(app: FastifyInstance, targets: ServerTargets) {
  app.get('/api/ssh-targets', (_req, reply) => respond(reply, () => targets.list()));
  app.post(
    '/api/ssh-targets',
    {
      errorHandler: (_error, _req, reply) => {
        void reply.code(400).send({ code: 'invalid_target', message: '手动服务器请求格式不合法' });
      },
    },
    (req, reply) => respond(reply, () => targets.save(req.body)),
  );
}
