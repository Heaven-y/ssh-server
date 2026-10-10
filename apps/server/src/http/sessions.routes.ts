// 会话接口操作对应 Agent 的原生记录，不另存或转换对话。
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AgentKindSchema, NativeSessionIdSchema, SessionActionSchema, SessionForkSchema } from '@ssh-server/shared';
import { SessionError, type SessionsService } from '../chat/sessions';
import type { WorkspaceStore } from '../workspaces/store';

const Params = z.object({ id: z.string().min(1), sessionId: NativeSessionIdSchema.optional() });
const Query = z.object({ agent: AgentKindSchema }).strict();
const ListQuery = Query.extend({ archived: z.enum(['true', 'false']).optional() });
type Deps = { store: Pick<WorkspaceStore, 'get'>; sessions: SessionsService };

export function registerSessionRoutes(app: FastifyInstance, deps: Deps): void {
  async function read(req: FastifyRequest, reply: FastifyReply, history: boolean) {
    reply.header('Cache-Control', 'no-store');
    const params = Params.safeParse(req.params);
    const query = (history ? Query : ListQuery).safeParse(req.query);
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
        : await deps.sessions.list(
            ws,
            query.data.agent,
            controller.signal,
            'archived' in query.data && query.data.archived === 'true',
          );
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
  app.post('/api/workspaces/:id/sessions/:sessionId/actions', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const params = Params.extend({ sessionId: NativeSessionIdSchema }).safeParse(req.params);
    const query = Query.safeParse(req.query);
    const input = SessionActionSchema.safeParse(req.body);
    if (!params.success || !query.success || !input.success)
      return reply.code(400).send({ message: '会话操作格式不正确；删除需确认，名称需为 1–200 个字符' });
    const ws = await deps.store.get(params.data.id);
    if (!ws) return reply.code(404).send({ message: '工作区不存在' });
    try {
      // 写入可能已生效，不将网页断开视为回滚；继续等待原生结果并释放会话锁。
      await deps.sessions.mutate(ws, query.data.agent, params.data.sessionId, input.data);
      return reply.code(204).send();
    } catch (error) {
      const failure =
        error instanceof SessionError ? error : new SessionError(503, 'session_runtime_failed', '原生会话操作失败');
      return reply.code(failure.status).send({ code: failure.code, message: failure.message });
    }
  });
  app.post(
    '/api/workspaces/:id/sessions/:sessionId/fork',
    {
      onRequest: (_req, reply, done) => {
        // 包括 JSON 解析失败等尚未进入处理器的响应。
        reply.header('Cache-Control', 'no-store');
        done();
      },
    },
    async (req, reply) => {
      const params = Params.extend({ sessionId: NativeSessionIdSchema }).safeParse(req.params);
      const query = Query.safeParse(req.query);
      const input = SessionForkSchema.safeParse(req.body);
      if (!params.success || !query.success || !input.success)
        return reply.code(400).send({ message: '会话分叉格式不正确；只能指定原生分叉点' });
      const ws = await deps.store.get(params.data.id);
      if (!ws) return reply.code(404).send({ message: '工作区不存在' });
      try {
        // 原生写入发出后，HTTP 断开不等于撤销；等待结果并由服务释放源会话锁。
        const session = await deps.sessions.fork(ws, query.data.agent, params.data.sessionId, input.data);
        return { session };
      } catch (error) {
        const failure =
          error instanceof SessionError ? error : new SessionError(503, 'session_runtime_failed', '原生会话分叉失败');
        return reply.code(failure.status).send({ code: failure.code, message: failure.message });
      }
    },
  );
}
