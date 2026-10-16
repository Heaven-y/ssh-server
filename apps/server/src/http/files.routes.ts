import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import type { Workspace } from '@ssh-server/shared';
import { anonymousFileError, WorkspaceFileError } from '../files/errors';
import type { WorkspaceFilesService } from '../files/service';
import type { WorkspaceStore } from '../workspaces/store';

export type FileRoutesDeps = {
  store: Pick<WorkspaceStore, 'get'>;
  files: WorkspaceFilesService;
};
const Params = z.object({ id: z.string().min(1) }).strict();
const Query = z.object({ path: z.string().max(4096).default('') }).strict();
const BASE = '/api/workspaces/:id';

async function respond(reply: FastifyReply, operation: () => Promise<unknown>) {
  try {
    return await operation();
  } catch (error) {
    const failure = anonymousFileError(error);
    return reply.code(failure.status).send({ code: failure.code, message: failure.message });
  }
}

/** 本地文件只读接口：目录列表与文件内容，不提供写入。 */
export function registerFileRoutes(app: FastifyInstance, deps: FileRoutesDeps): void {
  const options: RouteShorthandOptions = {
    onSend: async (_req, reply, payload) => {
      reply.header('Cache-Control', 'no-store');
      return payload;
    },
    errorHandler: (error, _req, reply) => {
      // 框架层错误也可能带正文片段；与 respond 一致地返回固定文案。
      const failure = new WorkspaceFileError(
        error.statusCode && error.statusCode < 500 ? 'invalid_request' : 'io_error',
      );
      void reply.code(failure.status).send({ code: failure.code, message: failure.message });
    },
  };

  async function workspace(req: FastifyRequest): Promise<Workspace> {
    const params = Params.safeParse(req.params);
    if (!params.success) throw new WorkspaceFileError('invalid_request');
    const ws = await deps.store.get(params.data.id);
    if (!ws) throw new WorkspaceFileError('workspace_missing');
    return ws;
  }
  function queryPath(req: FastifyRequest): string {
    const query = Query.safeParse(req.query);
    if (!query.success) throw new WorkspaceFileError('invalid_request');
    return query.data.path;
  }

  app.get(`${BASE}/files`, options, async (req, reply) =>
    respond(reply, async () => deps.files.list(await workspace(req), queryPath(req))),
  );
  app.get(`${BASE}/file`, options, async (req, reply) =>
    respond(reply, async () => deps.files.read(await workspace(req), queryPath(req))),
  );
}
