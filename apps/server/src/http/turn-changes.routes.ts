import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AgentKindSchema, NativeSessionIdSchema } from '@ssh-server/shared';
import { SessionError, type SessionsService } from '../chat/sessions';
import type { TurnChanges } from '../chat/turn-changes';
import { VersionError } from '../vcs/errors';
import type { WorkspaceStore } from '../workspaces/store';

type Deps = {
  store: Pick<WorkspaceStore, 'get'>;
  changes: Pick<TurnChanges, 'list' | 'diff'>;
  sessions: Pick<SessionsService, 'assertBelongs'>;
};
const Params = z.object({ id: z.string().min(1), turnId: z.uuid().optional() }).strict();
const Query = z
  .object({
    agent: AgentKindSchema,
    sessionId: NativeSessionIdSchema.optional(),
    path: z.string().min(1).max(4096).optional(),
  })
  .strict();

function requestTarget(req: { params: unknown; query: unknown }, diff: boolean) {
  const params = Params.safeParse(req.params);
  const query = Query.safeParse(req.query);
  if (!params.success || !query.success || (!diff && query.data.path))
    throw new SessionError(400, 'invalid_request', '本轮改动请求格式不正确');
  return { params: params.data, query: query.data };
}

export function registerTurnChangesRoutes(app: FastifyInstance, deps: Deps): void {
  async function read(req: { params: unknown; query: unknown }, reply: FastifyReply, diff: boolean) {
    reply.header('Cache-Control', 'no-store');
    try {
      const { params, query } = requestTarget(req, diff);
      const ws = await deps.store.get(params.id);
      if (!ws) throw new SessionError(404, 'workspace_missing', '工作区不存在');
      if (query.sessionId) await deps.sessions.assertBelongs(ws, query.agent, query.sessionId);
      const target = { agent: query.agent, sessionId: query.sessionId };
      return diff
        ? await deps.changes.diff(ws, params.turnId!, target, query.path)
        : { records: await deps.changes.list(ws, target) };
    } catch (error) {
      const fixed =
        error instanceof VersionError || error instanceof SessionError
          ? error
          : new SessionError(503, 'changes_failed', '本轮改动读取失败');
      return reply.code(fixed.status).send({ code: fixed.code, message: fixed.message });
    }
  }
  const base = '/api/workspaces/:id/turn-changes';
  app.get(base, (req, reply) => read(req, reply, false));
  app.get(`${base}/:turnId/diff`, (req, reply) => read(req, reply, true));
}
