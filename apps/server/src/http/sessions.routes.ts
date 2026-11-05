// 会话接口统一按项目、CLI 与原生会话 id 定位，不另存正文，也不保留旧工作区路径。
import type { FastifyInstance, FastifyReply, FastifyRequest, onRequestHookHandler } from 'fastify';
import { z } from 'zod';
import {
  AgentKindSchema,
  NativeSessionIdSchema,
  SessionActionSchema,
  SessionForkSchema,
  type Workspace,
} from '@agentdeck/shared';
import { SessionError, type SessionsService } from '../chat/sessions';
import type { WorkspaceStore } from '../workspaces/store';
import { WorkspaceBusyError, type WorkspaceActivity } from '../workspaces/activity';

const ProjectIdParams = z.object({ id: z.string().min(1) });
const ProjectHistoryParams = ProjectIdParams.extend({
  agent: AgentKindSchema,
  sessionId: NativeSessionIdSchema,
});
const Query = z.object({ agent: AgentKindSchema }).strict();
const ListQuery = Query.extend({ archived: z.enum(['true', 'false']).optional() });
const EmptyQuery = z.strictObject({});
type Deps = { store: Pick<WorkspaceStore, 'get'>; sessions: SessionsService; activity?: WorkspaceActivity };
/** JSON 解析和参数校验可能先失败，缓存策略必须在进入处理器前设置。 */
const noStore: onRequestHookHandler = (_req, reply, done) => {
  reply.header('Cache-Control', 'no-store');
  done();
};
const routeOptions = { onRequest: noStore };

function sendFailure(reply: FastifyReply, error: unknown, message: string) {
  if (error instanceof WorkspaceBusyError)
    return reply.code(409).send({ code: 'project_busy', message: error.message });
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
  async function globalList(req: FastifyRequest, reply: FastifyReply, archived: boolean) {
    const query = Query.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ message: '会话请求格式不正确' });
    const watch = watchAbort(reply);
    try {
      return archived
        ? await deps.sessions.archived(query.data.agent, watch.signal)
        : await deps.sessions.unassigned(query.data.agent, watch.signal);
    } catch (error) {
      return sendFailure(reply, error, '原生会话读取失败');
    } finally {
      watch.dispose();
    }
  }
  app.get('/api/sessions', routeOptions, (req, reply) => globalList(req, reply, false));
  app.get('/api/sessions/archived', routeOptions, (req, reply) => globalList(req, reply, true));
  async function writeInProject<T>(id: string, operation: (workspace: Workspace) => Promise<T>): Promise<T> {
    // 同步取得租约再读取项目，避免管理事务先换目录、会话写操作后使用旧快照。
    const release = deps.activity?.acquire(id);
    try {
      const workspace = await deps.store.get(id);
      if (!workspace) throw new SessionError(404, 'workspace_missing', '项目不存在');
      return await operation(workspace);
    } finally {
      release?.();
    }
  }
  async function list(req: FastifyRequest, reply: FastifyReply) {
    const params = ProjectIdParams.safeParse(req.params);
    const query = ListQuery.safeParse(req.query);
    if (!params.success || !query.success) return reply.code(400).send({ message: '会话请求格式不正确' });
    const ws = await deps.store.get(params.data.id);
    if (!ws) return reply.code(404).send({ message: '项目不存在' });
    const watch = watchAbort(reply);
    try {
      const sessions = await deps.sessions.list(ws, query.data.agent, watch.signal, query.data.archived === 'true');
      // 全局元数据按唯一归属投影；保留未归属行兼容项目列表，零项目入口由 /api/sessions 提供。
      return sessions.filter((session) => session.projectId === ws.id || session.projectId === null);
    } catch (error) {
      return sendFailure(reply, error, '原生会话读取失败');
    } finally {
      watch.dispose();
    }
  }

  async function read(req: FastifyRequest, reply: FastifyReply) {
    const params = ProjectHistoryParams.safeParse(req.params);
    if (!params.success || !EmptyQuery.safeParse(req.query).success)
      return reply.code(400).send({ message: '会话请求格式不正确' });
    const ws = await deps.store.get(params.data.id);
    if (!ws) return reply.code(404).send({ message: '项目不存在' });
    const watch = watchAbort(reply);
    try {
      return await deps.sessions.read(ws, params.data.agent, params.data.sessionId, watch.signal);
    } catch (error) {
      return sendFailure(reply, error, '原生会话读取失败');
    } finally {
      watch.dispose();
    }
  }

  app.get('/api/projects/:id/sessions', routeOptions, list);
  app.get('/api/projects/:id/sessions/:agent/:sessionId', routeOptions, read);

  app.post('/api/projects/:id/sessions/:agent/:sessionId/actions', routeOptions, async (req, reply) => {
    const params = ProjectHistoryParams.safeParse(req.params);
    const query = EmptyQuery.safeParse(req.query);
    const input = SessionActionSchema.safeParse(req.body);
    if (!params.success || !query.success || !input.success)
      return reply.code(400).send({ message: '会话操作格式不正确；删除需确认，名称需为 1–200 个字符' });
    try {
      // 写入可能已生效，不将网页断开视为回滚；继续等待原生结果并释放会话锁。
      await writeInProject(params.data.id, (ws) =>
        deps.sessions.mutate(ws, params.data.agent, params.data.sessionId, input.data),
      );
      return reply.code(204).send();
    } catch (error) {
      return sendFailure(reply, error, '原生会话操作失败');
    }
  });

  app.post('/api/projects/:id/sessions/:agent/:sessionId/fork', routeOptions, async (req, reply) => {
    const params = ProjectHistoryParams.safeParse(req.params);
    const query = EmptyQuery.safeParse(req.query);
    const input = SessionForkSchema.safeParse(req.body);
    if (!params.success || !query.success || !input.success)
      return reply.code(400).send({ message: '会话分叉格式不正确；只能指定原生分叉点' });
    try {
      // 原生写入发出后，HTTP 断开不等于撤销；等待结果并由服务释放源会话锁。
      const session = await writeInProject(params.data.id, (ws) =>
        deps.sessions.fork(ws, params.data.agent, params.data.sessionId, input.data),
      );
      return { session };
    } catch (error) {
      return sendFailure(reply, error, '原生会话分叉失败');
    }
  });
}
