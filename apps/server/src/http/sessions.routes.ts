// 会话接口：读取按项目路径组织（项目 id + agent + 原生会话 id），直接读各 CLI 的原生记录，
// 不另存或转换对话。
//
// 兼容期说明：M1 前端仍调用 /api/workspaces/:id/sessions 与 .../:sessionId/events 这两个旧读取
// 路径，Task 10 重写外壳后才切到新路径。这里保留它们作为转发别名（返回同样的结果），不保留第二套
// 读取实现；动作与分叉仍是旧前缀，随 Task 10 一并迁移。
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AgentKindSchema, NativeSessionIdSchema, SessionActionSchema, SessionForkSchema } from '@agentdeck/shared';
import { SessionError, type SessionsService } from '../chat/sessions';
import type { WorkspaceStore } from '../workspaces/store';

const ProjectIdParams = z.object({ id: z.string().min(1) });
const ProjectHistoryParams = ProjectIdParams.extend({
  agent: AgentKindSchema,
  sessionId: NativeSessionIdSchema,
});
const Params = z.object({ id: z.string().min(1), sessionId: NativeSessionIdSchema.optional() });
const Query = z.object({ agent: AgentKindSchema }).strict();
const ListQuery = Query.extend({ archived: z.enum(['true', 'false']).optional() });
type Deps = { store: Pick<WorkspaceStore, 'get'>; sessions: SessionsService };

function sendFailure(reply: FastifyReply, error: unknown, message: string) {
  const failure = error instanceof SessionError ? error : new SessionError(503, 'session_runtime_failed', message);
  return reply.code(failure.status).send({ code: failure.code, message: failure.message });
}

/** 断开连接时取消原生读取；写入类请求不能用它撤销已经发出的原生操作。 */
function watchAbort(reply: FastifyReply) {
  const controller = new AbortController();
  const closed = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  reply.raw.once('close', closed);
  return { signal: controller.signal, dispose: () => reply.raw.removeListener('close', closed) };
}

export function registerSessionRoutes(app: FastifyInstance, deps: Deps): void {
  async function list(req: FastifyRequest, reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    const params = ProjectIdParams.safeParse(req.params);
    const query = ListQuery.safeParse(req.query);
    if (!params.success || !query.success) return reply.code(400).send({ message: '会话请求格式不正确' });
    const ws = await deps.store.get(params.data.id);
    if (!ws) return reply.code(404).send({ message: '项目不存在' });
    const watch = watchAbort(reply);
    try {
      const sessions = await deps.sessions.list(ws, query.data.agent, watch.signal, query.data.archived === 'true');
      // Antigravity 的 list() 不按目录过滤，Claude/Codex 的行也可能归给别的项目（例如配置顺序更靠前的
      // 父目录）；统一按投影出来的 projectId 裁掉不属于本项目的会话，不能把整批原生会话塞进当前项目。
      return sessions.filter((session) => session.projectId === ws.id);
    } catch (error) {
      return sendFailure(reply, error, '原生会话读取失败');
    } finally {
      watch.dispose();
    }
  }

  /** agent 来自路径段（新路径）或查询参数（旧路径）；两条路径共用同一份判权与读取逻辑。 */
  async function read(id: string, agent: string, sessionId: string, reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    const parsedAgent = AgentKindSchema.safeParse(agent);
    if (!parsedAgent.success || !NativeSessionIdSchema.safeParse(sessionId).success)
      return reply.code(400).send({ message: '会话请求格式不正确' });
    const ws = await deps.store.get(id);
    if (!ws) return reply.code(404).send({ message: '项目不存在' });
    const watch = watchAbort(reply);
    try {
      return await deps.sessions.read(ws, parsedAgent.data, sessionId, watch.signal);
    } catch (error) {
      return sendFailure(reply, error, '原生会话读取失败');
    } finally {
      watch.dispose();
    }
  }

  app.get('/api/projects/:id/sessions', (req, reply) => list(req, reply));

  app.get('/api/projects/:id/sessions/:agent/:sessionId', (req, reply) => {
    const params = ProjectHistoryParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ message: '会话请求格式不正确' });
    return read(params.data.id, params.data.agent, params.data.sessionId, reply);
  });

  // 兼容期别名：结果与上面完全一致，Task 10 迁移前端后删除。
  app.get('/api/workspaces/:id/sessions', (req, reply) => list(req, reply));
  app.get('/api/workspaces/:id/sessions/:sessionId/events', (req, reply) => {
    const params = Params.extend({ sessionId: NativeSessionIdSchema }).safeParse(req.params);
    const query = Query.safeParse(req.query);
    if (!params.success || !query.success) return reply.code(400).send({ message: '会话请求格式不正确' });
    return read(params.data.id, query.data.agent, params.data.sessionId, reply);
  });

  app.post('/api/workspaces/:id/sessions/:sessionId/actions', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const params = Params.extend({ sessionId: NativeSessionIdSchema }).safeParse(req.params);
    const query = Query.safeParse(req.query);
    const input = SessionActionSchema.safeParse(req.body);
    if (!params.success || !query.success || !input.success)
      return reply.code(400).send({ message: '会话操作格式不正确；删除需确认，名称需为 1–200 个字符' });
    const ws = await deps.store.get(params.data.id);
    if (!ws) return reply.code(404).send({ message: '项目不存在' });
    try {
      // 写入可能已生效，不将网页断开视为回滚；继续等待原生结果并释放会话锁。
      await deps.sessions.mutate(ws, query.data.agent, params.data.sessionId, input.data);
      return reply.code(204).send();
    } catch (error) {
      return sendFailure(reply, error, '原生会话操作失败');
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
      if (!ws) return reply.code(404).send({ message: '项目不存在' });
      try {
        // 原生写入发出后，HTTP 断开不等于撤销；等待结果并由服务释放源会话锁。
        const session = await deps.sessions.fork(ws, query.data.agent, params.data.sessionId, input.data);
        return { session };
      } catch (error) {
        return sendFailure(reply, error, '原生会话分叉失败');
      }
    },
  );
}
