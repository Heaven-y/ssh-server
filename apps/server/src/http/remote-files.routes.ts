import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { remoteFilesError, RemoteFilesError } from '../remote-files/errors';
import type { RemoteFilesService } from '../remote-files/service';

const Params = z.object({ id: z.string().min(1), sessionId: z.string().uuid().optional() }).strict();
const Target = z
  .object({
    sshHost: z.string().min(1),
    authMode: z.enum(['key', 'password']).optional(),
    remoteDir: z.string().min(1).max(4096),
    localDir: z.string().min(1),
  })
  .strict();
const Query = z.object({ path: z.string().max(4096).default(''), cursor: z.string().uuid().optional() }).strict();
const Empty = z.object({}).strict();
const OpenTarget = Target.extend({ binding: z.string().regex(/^[a-f0-9]{64}$/) });

function requestSignal(request: FastifyRequest, reply: FastifyReply, onAbort?: () => void) {
  const controller = new AbortController();
  const abort = () => {
    controller.abort(new RemoteFilesError('cancelled'));
    onAbort?.();
  };
  const cleanup = () => {
    request.raw.removeListener('aborted', abort);
    reply.raw.removeListener('close', closed);
    reply.raw.removeListener('finish', cleanup);
  };
  const closed = () => {
    if (!reply.raw.writableFinished) abort();
    cleanup();
  };
  request.raw.once('aborted', abort);
  reply.raw.once('close', closed);
  reply.raw.once('finish', cleanup);
  if (request.raw.aborted || reply.raw.destroyed) abort();
  return controller.signal;
}

async function respond(reply: FastifyReply, operation: () => unknown) {
  try {
    return await operation();
  } catch (error) {
    const failure = remoteFilesError(error);
    return reply.code(failure.status).send({ code: failure.code, message: failure.message });
  }
}

export function registerRemoteFileRoutes(app: FastifyInstance, service: RemoteFilesService): void {
  const base = '/api/workspaces/:id/remote-files/sessions';
  const options: RouteShorthandOptions = {
    bodyLimit: 16_384,
    onSend: async (_request: unknown, reply: FastifyReply, payload: unknown) => {
      reply.header('Cache-Control', 'no-store');
      return payload;
    },
    errorHandler: (_error, _request, reply) => {
      const failure = new RemoteFilesError('invalid_request');
      void reply.code(failure.status).send({ code: failure.code, message: failure.message });
    },
  };
  app.post('/api/workspaces/:id/remote-files/bindings', options, async (request, reply) => {
    const signal = requestSignal(request, reply);
    return respond(reply, async () => {
      const params = Params.safeParse(request.params);
      const target = Target.safeParse(request.body);
      if (!params.success || !target.success || !Empty.safeParse(request.query).success)
        throw new RemoteFilesError('invalid_request');
      return service.binding(params.data.id, target.data, signal);
    });
  });
  app.post(base, options, async (request, reply) => {
    let created: { workspaceId: string; id: string } | undefined;
    const signal = requestSignal(request, reply, () => {
      if (created) service.close(created.workspaceId, created.id);
    });
    return respond(reply, async () => {
      const params = Params.safeParse(request.params);
      const target = OpenTarget.safeParse(request.body);
      if (!params.success || !target.success || !Empty.safeParse(request.query).success)
        throw new RemoteFilesError('invalid_request');
      const result = await service.open(params.data.id, target.data, signal);
      created = result;
      if (signal.aborted) {
        service.close(result.workspaceId, result.id);
        signal.throwIfAborted();
      }
      return result;
    });
  });
  app.get(`${base}/:sessionId`, options, async (request, reply) => {
    const signal = requestSignal(request, reply);
    return respond(reply, async () => {
      const params = Params.safeParse(request.params);
      const query = Query.safeParse(request.query);
      if (!params.success || !params.data.sessionId || !query.success) throw new RemoteFilesError('invalid_request');
      return service.list(params.data.id, params.data.sessionId, query.data, signal);
    });
  });
  app.delete(`${base}/:sessionId`, options, async (request, reply) =>
    respond(reply, () => {
      const params = Params.safeParse(request.params);
      if (
        !params.success ||
        !params.data.sessionId ||
        !Empty.safeParse(request.query).success ||
        request.body !== undefined
      )
        throw new RemoteFilesError('invalid_request');
      service.close(params.data.id, params.data.sessionId);
      return reply.code(204).send();
    }),
  );
  app.addHook('onClose', (_instance, done) => {
    service.dispose();
    done();
  });
}
