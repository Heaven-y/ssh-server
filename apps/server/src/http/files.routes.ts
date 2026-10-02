import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { MAX_EDITABLE_FILE_BYTES, type Workspace } from '@ssh-server/shared';
import { anonymousFileError, WorkspaceFileError } from '../files/errors';
import type { WorkspaceFilesService } from '../files/service';
import type { SyncManager } from '../sync/manager';
import type { WorkspaceStore } from '../workspaces/store';

export type FileRoutesDeps = {
  store: Pick<WorkspaceStore, 'get'>;
  files: WorkspaceFilesService;
  sync: Pick<SyncManager, 'transaction'>;
};
const Params = z.object({ id: z.string().min(1) }).strict();
const Query = z.object({ path: z.string().max(4096).default('') }).strict();
const Body = z
  .object({ path: z.string().min(1).max(4096), content: z.string(), revision: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const BASE = '/api/workspaces/:id';

async function respond(reply: FastifyReply, operation: () => Promise<unknown>) {
  try {
    return await operation();
  } catch (error) {
    const failure = anonymousFileError(error);
    return reply.code(failure.status).send({ code: failure.code, message: failure.message });
  }
}

export function registerFileRoutes(app: FastifyInstance, deps: FileRoutesDeps): void {
  const options: RouteShorthandOptions = {
    bodyLimit: MAX_EDITABLE_FILE_BYTES * 6 + 16_384,
    onSend: async (_req, reply, payload) => {
      reply.header('Cache-Control', 'no-store');
      return payload;
    },
    errorHandler: (error, _req, reply) => {
      // HTTP 解析错误也可能带正文片段；统一替换为固定文案。
      const code = error.statusCode === 413 ? 'too_large' : 'invalid_request';
      const failure = new WorkspaceFileError(error.statusCode && error.statusCode < 500 ? code : 'io_error');
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
  app.get(`${BASE}/file/revision`, options, async (req, reply) =>
    respond(reply, async () => deps.files.revision(await workspace(req), queryPath(req))),
  );
  app.put(`${BASE}/file`, options, async (req, reply) =>
    respond(reply, async () => {
      const body = Body.safeParse(req.body);
      if (!body.success || Object.keys(req.query as object).length) throw new WorkspaceFileError('invalid_request');
      const ws = await workspace(req);
      return deps.sync.transaction(ws, async () => {
        // 排队时可能修改了工作区或同步阈值，实际保存使用事务开始后的配置。
        const current = await workspace(req);
        if (current.localDir !== ws.localDir) throw new WorkspaceFileError('revision_conflict');
        return deps.files.save(current, body.data);
      });
    }),
  );
}
