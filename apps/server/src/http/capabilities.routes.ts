import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AgentKindSchema, NativeSessionIdSchema } from '@agentdeck/shared';
import type { CapabilitiesService } from '../chat/capabilities';
import { SessionError, type SessionsService } from '../chat/sessions';
import type { WorkspaceStore } from '../workspaces/store';
import { assertCapabilityDirectory } from '../agents/capability-directory';

const Params = z.object({ id: z.string().min(1) });
const Query = z.object({ agent: AgentKindSchema, sessionId: NativeSessionIdSchema.optional() }).strict();
export function registerCapabilityRoutes(
  app: FastifyInstance,
  deps: {
    store: Pick<WorkspaceStore, 'get'>;
    capabilities: CapabilitiesService;
    sessions: Pick<SessionsService, 'assertBelongs'>;
  },
): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/workspaces/:id/agent-capabilities',
    handler: async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const params = Params.safeParse(req.params);
      const query = Query.safeParse(req.query);
      if (!params.success || !query.success) return reply.code(400).send({ message: '能力请求格式不正确' });
      let ws = await deps.store.get(params.data.id);
      if (!ws) return reply.code(404).send({ message: '工作区不存在' });
      const controller = new AbortController();
      const closed = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      reply.raw.once('close', closed);
      try {
        if (query.data.sessionId) {
          await assertCapabilityDirectory(ws.dir);
          ws = await deps.sessions.assertBelongs(ws, query.data.agent, query.data.sessionId, controller.signal);
        }
        return req.method === 'POST'
          ? await deps.capabilities.refresh(ws, query.data.agent, controller.signal)
          : await deps.capabilities.read(ws, query.data.agent);
      } catch (error) {
        const failure =
          error instanceof SessionError ? error : new SessionError(503, 'capabilities_unavailable', '原生能力读取失败');
        return reply.code(failure.status).send({ code: failure.code, message: failure.message });
      } finally {
        reply.raw.removeListener('close', closed);
      }
    },
  });
}
