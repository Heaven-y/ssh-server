import type { FastifyInstance, FastifyReply } from 'fastify';
import { WorkspacePolicyInputSchema } from '@ssh-server/shared';
import { WorkspacePolicyError, type WorkspacePolicyService } from '../workspaces/policy';
import { WorkspaceValidationError } from '../workspaces/store';

async function respond<T>(reply: FastifyReply, operation: () => Promise<T>) {
  reply.header('Cache-Control', 'no-store');
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkspacePolicyError)
      return reply.code(error.status).send({ code: error.code, message: error.message });
    if (error instanceof WorkspaceValidationError)
      return reply.code(400).send({ field: error.field, message: error.message });
    return reply.code(503).send({ code: 'policy_unavailable', message: '命令规则未能读写，请检查本机配置目录后重试' });
  }
}
export function registerWorkspacePolicyRoutes(app: FastifyInstance, service: WorkspacePolicyService) {
  app.get<{ Params: { id: string } }>('/api/workspaces/:id/policy', (req, reply) =>
    respond(reply, () => service.read(req.params.id)),
  );
  app.put<{ Params: { id: string } }>('/api/workspaces/:id/policy', (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = WorkspacePolicyInputSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ code: 'policy_input_invalid', message: '命令规则或配置版本不合法' });
    return respond(reply, () => service.save(req.params.id, parsed.data));
  });
}
