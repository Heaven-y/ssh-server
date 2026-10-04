import type { FastifyInstance } from 'fastify';
import { TerminalTargetSchema } from '@ssh-server/shared';
import { ResourceTargetError, type ResourcesService } from '../resources/service';

export function registerResourcesRoutes(app: FastifyInstance, resources: ResourcesService): void {
  app.get<{ Params: { id: string }; Querystring: { target?: string } }>(
    '/api/workspaces/:id/resources',
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      let input: unknown;
      try {
        input = JSON.parse(req.query.target ?? '');
      } catch {
        return reply.code(400).send({ message: '需要固定的资源采样目标' });
      }
      const parsed = TerminalTargetSchema.safeParse(input);
      if (!parsed.success || parsed.data.workspaceId !== req.params.id)
        return reply.code(400).send({ message: '资源采样目标不合法' });
      try {
        return await resources.get(parsed.data);
      } catch (error) {
        if (error instanceof ResourceTargetError)
          return reply
            .code(error.code === 'workspace_missing' ? 404 : 409)
            .send({ code: error.code, message: error.message });
        return reply.code(502).send({ code: 'resource_unavailable', message: '资源采样不可用，请检查SSH连接后重试' });
      }
    },
  );
  app.addHook('preClose', () => {
    resources.dispose();
  });
}
