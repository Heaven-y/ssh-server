// 会话接口只读取对应 Agent 的原生记录，不另存或转换对话。
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AgentKindSchema, NativeSessionIdSchema } from '@ssh-server/shared';
import { SessionError, type SessionsService } from '../chat/sessions';
import type { WorkspaceStore } from '../workspaces/store';

const Params = z.object({ id: z.string().min(1), sessionId: NativeSessionIdSchema.optional() });
const Query = z.object({ agent: AgentKindSchema.default('claude') }).strict();
type Deps = { store: Pick<WorkspaceStore, 'get'>; sessions: SessionsService };

export function registerSessionRoutes(app: FastifyInstance, deps: Deps): void {
  async function read(req: FastifyRequest, reply: FastifyReply, history: boolean) {
    reply.header('Cache-Control', 'no-store');
    const params = Params.safeParse(req.params);
    const query = Query.safeParse(req.query);
    if (!params.success || !query.success) return reply.code(400).send({ message: '会话请求格式不正确' });
    const ws = await deps.store.get(params.data.id);
    if (!ws) return reply.code(404).send({ message: '工作区不存在' });
    const controller = new AbortController();
    const closed = () => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.once('close', closed);
    try {
      return history
        ? await deps.sessions.read(ws, query.data.agent, params.data.sessionId!, controller.signal)
        : await deps.sessions.list(ws, query.data.agent, controller.signal);
    } catch (error) {
      const failure =
        error instanceof SessionError ? error : new SessionError(503, 'session_runtime_failed', '原生会话读取失败');
      return reply.code(failure.status).send({ code: failure.code, message: failure.message });
    } finally {
      reply.raw.removeListener('close', closed);
    }
  }
  app.get('/api/workspaces/:id/sessions', (req, reply) => read(req, reply, false));
  app.get('/api/workspaces/:id/sessions/:sessionId/events', (req, reply) => read(req, reply, true));
}
