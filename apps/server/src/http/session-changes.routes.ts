import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SessionChangesService } from '../sessions/changes';
export function registerSessionChangesRoutes(app: FastifyInstance, service: SessionChangesService): void {
  app.get('/api/session-changes', (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!z.strictObject({}).safeParse(req.query).success)
      return reply.code(400).send({ message: '会话变化请求不接受额外参数' });
    return service.read();
  });
  app.addHook('preClose', () => {
    service.dispose();
  });
}
