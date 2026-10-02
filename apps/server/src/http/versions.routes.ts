import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { VERSION_MESSAGE_MAX_LENGTH, type Workspace } from '@ssh-server/shared';
import { VersionError } from '../vcs/errors';
import type { VersionsService } from '../vcs/service';
import type { WorkspaceStore } from '../workspaces/store';
import type { SyncManager } from '../sync/manager';

type Deps = { store: Pick<WorkspaceStore, 'get'>; versions: VersionsService; sync: Pick<SyncManager, 'transaction'> };
const Path = z.string().min(1).max(4096);
const Commit = z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/);
const Revision = z.string().regex(/^[a-f0-9]{64}$/);
const Empty = z.object({}).strict();
const Params = z.object({ id: z.string().min(1) }).strict();
const History = z.object({ skip: z.coerce.number().int().min(0).max(1_000_000).default(0) }).strict();
const Diff = z.object({ commit: Commit.optional(), path: Path.optional() }).strict();
const Save = z
  .object({ message: z.string().trim().min(1).max(VERSION_MESSAGE_MAX_LENGTH), revision: Revision })
  .strict();
const Preview = z.object({ commit: Commit, path: Path.optional() }).strict();
const Restore = Preview.extend({ revision: Revision, confirmed: z.literal(true) });
const BASE = '/api/workspaces/:id/versions';

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new VersionError('invalid_request');
  return result.data;
}

function failure(reply: FastifyReply, error: unknown) {
  const fixed = error instanceof VersionError ? error : new VersionError('git_error');
  return reply
    .code(fixed.status)
    .send({ code: fixed.code, message: fixed.message, affectedPaths: fixed.affectedPaths });
}

export function registerVersionRoutes(app: FastifyInstance, deps: Deps): void {
  const options: RouteShorthandOptions = {
    bodyLimit: 32 * 1024,
    onSend: async (_req, reply, payload) => {
      reply.header('Cache-Control', 'no-store');
      return payload;
    },
    errorHandler: (error, _req, reply) => {
      void failure(
        reply,
        new VersionError(error.statusCode && error.statusCode < 500 ? 'invalid_request' : 'git_error'),
      );
    },
  };
  async function workspace(req: FastifyRequest): Promise<Workspace> {
    const params = parse(Params, req.params);
    const ws = await deps.store.get(params.id);
    if (!ws) throw new VersionError('workspace_missing');
    return ws;
  }
  async function respond(
    req: FastifyRequest,
    reply: FastifyReply,
    operation: (ws: Workspace) => Promise<unknown>,
    write = false,
  ) {
    try {
      const ws = await workspace(req);
      if (!write) return await operation(ws);
      return await deps.sync.transaction(ws, async () => {
        const current = await workspace(req);
        if (current.localDir !== ws.localDir) throw new VersionError('stale_revision');
        return operation(current);
      });
    } catch (error) {
      return failure(reply, error);
    }
  }
  app.post(`${BASE}/initialize`, options, async (req, reply) =>
    respond(
      req,
      reply,
      (ws) => {
        parse(Empty, req.query);
        parse(Empty, req.body ?? {});
        return deps.versions.initialize(ws);
      },
      true,
    ),
  );
  app.get(BASE, options, async (req, reply) =>
    respond(req, reply, (ws) => {
      parse(Empty, req.query);
      return deps.versions.status(ws);
    }),
  );
  app.get(`${BASE}/history`, options, async (req, reply) =>
    respond(req, reply, (ws) => deps.versions.history(ws, parse(History, req.query).skip)),
  );
  app.get(`${BASE}/diff`, options, async (req, reply) =>
    respond(req, reply, (ws) => deps.versions.diff(ws, parse(Diff, req.query))),
  );
  app.post(`${BASE}/save`, options, async (req, reply) =>
    respond(
      req,
      reply,
      (ws) => {
        parse(Empty, req.query);
        return deps.versions.save(ws, parse(Save, req.body));
      },
      true,
    ),
  );
  app.post(`${BASE}/restore/preview`, options, async (req, reply) =>
    respond(req, reply, (ws) => {
      parse(Empty, req.query);
      return deps.versions.previewRestore(ws, parse(Preview, req.body));
    }),
  );
  app.post(`${BASE}/restore`, options, async (req, reply) =>
    respond(
      req,
      reply,
      (ws) => {
        parse(Empty, req.query);
        return deps.versions.restore(ws, parse(Restore, req.body));
      },
      true,
    ),
  );
}
