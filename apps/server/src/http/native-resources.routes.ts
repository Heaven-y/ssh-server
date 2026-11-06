import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { NativeResourceError, resourceError } from '../agents/common/configuration/errors';
import { MAX_CONFIG_BYTES } from '../platform/files/safe-file';
import type { NativeResourcesService } from '../settings/native-resources';
import { WorkspaceBusyError, type WorkspaceActivity } from '../workspaces/activity';
import type { WorkspaceStore } from '../workspaces/store';

export type NativeResourceRoutesDeps = {
  service: NativeResourcesService;
  store: Pick<WorkspaceStore, 'get'>;
  activity?: WorkspaceActivity;
};
const Id = z.string().regex(/^[a-f0-9]{64}$/);
const Params = z.object({ agent: z.enum(['claude', 'codex', 'antigravity']), resourceId: Id.optional() }).strict();
const Query = z.object({ projectId: z.string().min(1).max(128).optional() }).strict();
const OpenBody = z.object({}).strict().optional();
const SaveBody = z.object({ content: z.string(), revision: z.string().regex(/^(?:missing|[a-f0-9]{64})$/) }).strict();
const CreateBody = z.object({ rootId: Id, name: z.string().min(1).max(100), content: z.string() }).strict();

async function requestContext(req: FastifyRequest, deps: NativeResourceRoutesDeps) {
  const params = Params.safeParse(req.params);
  const query = Query.safeParse(req.query);
  if (!params.success || !query.success) throw new NativeResourceError('invalid_request');
  const project = query.data.projectId ? await deps.store.get(query.data.projectId) : undefined;
  if (query.data.projectId && !project) throw new NativeResourceError('project_missing');
  return { ...params.data, project };
}

async function respond(reply: FastifyReply, operation: () => Promise<unknown>) {
  reply.header('Cache-Control', 'no-store');
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkspaceBusyError)
      return reply.code(409).send({ code: 'project_busy', message: error.message });
    const failure = resourceError(error);
    return reply.code(failure.status).send({ code: failure.code, message: failure.message });
  }
}

async function writeInProject<T>(req: FastifyRequest, deps: NativeResourceRoutesDeps, operation: () => Promise<T>) {
  const query = Query.safeParse(req.query);
  if (!query.success) throw new NativeResourceError('invalid_request');
  // 写入开始前占用项目，覆盖读取目录快照和整个文件事务；客户端断开不代表原生写入回滚。
  const release = query.data.projectId ? deps.activity?.acquire(query.data.projectId) : undefined;
  try {
    return await operation();
  } finally {
    release?.();
  }
}

export function registerNativeResourceRoutes(app: FastifyInstance, deps: NativeResourceRoutesDeps): void {
  const options: RouteShorthandOptions = {
    bodyLimit: MAX_CONFIG_BYTES * 6 + 512,
    onSend: async (_req, reply, payload) => {
      reply.header('Cache-Control', 'no-store');
      return payload;
    },
    errorHandler: (error, _req, reply) => {
      const code = error.statusCode === 413 ? 'too_large' : 'invalid_request';
      const failure = new NativeResourceError(error.statusCode && error.statusCode < 500 ? code : 'io_error');
      void reply.code(failure.status).send({ code: failure.code, message: failure.message });
    },
  };
  app.get('/api/native-resources/:agent', options, (req, reply) =>
    respond(reply, async () => {
      const { agent, project } = await requestContext(req, deps);
      return deps.service.list(agent, project);
    }),
  );
  app.post('/api/native-resources/:agent/:resourceId/open', options, (req, reply) =>
    respond(reply, async () => {
      const { agent, resourceId, project } = await requestContext(req, deps);
      if (!OpenBody.safeParse(req.body).success || !resourceId) throw new NativeResourceError('invalid_request');
      return deps.service.open(agent, resourceId, project);
    }),
  );
  app.put('/api/native-resources/:agent/:resourceId', options, (req, reply) =>
    respond(reply, () =>
      writeInProject(req, deps, async () => {
        const { agent, resourceId, project } = await requestContext(req, deps);
        const input = SaveBody.safeParse(req.body);
        if (!input.success || !resourceId) throw new NativeResourceError('invalid_request');
        return deps.service.save(agent, resourceId, input.data, project);
      }),
    ),
  );
  app.post('/api/native-resources/:agent', options, (req, reply) =>
    respond(reply, () =>
      writeInProject(req, deps, async () => {
        const { agent, project } = await requestContext(req, deps);
        const input = CreateBody.safeParse(req.body);
        if (!input.success) throw new NativeResourceError('invalid_request');
        const saved = await deps.service.create(agent, input.data, project);
        reply.code(201);
        return saved;
      }),
    ),
  );
}
