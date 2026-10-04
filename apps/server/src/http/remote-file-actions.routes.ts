import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { FileDownloads } from '../remote-files/downloads';
import { remoteFilesError, RemoteFilesError } from '../remote-files/errors';
import type { FilePreflights } from '../remote-files/preflight';
import type { FileTasks } from '../remote-files/tasks';
import { requestSignal } from './remote-files.routes';

const Params = z
  .object({ id: z.string().min(1), sessionId: z.string().uuid().optional(), taskId: z.string().uuid().optional() })
  .strict();
const Path = z.string().min(1).max(4096);
const Action = z
  .object({
    kind: z.enum(['mkdir', 'rename', 'move', 'copy', 'delete']),
    source: Path.optional(),
    destination: Path.optional(),
  })
  .strict();
const Submit = z.object({ preflightId: z.string().uuid(), confirmed: z.literal(true) }).strict();
const Recover = z.object({ confirmed: z.literal(true) }).strict();
const Query = z.object({ path: Path }).strict();
const Empty = z.object({}).strict();
type Deps = { preflights: FilePreflights; tasks: FileTasks; downloads: FileDownloads };
async function respond(reply: FastifyReply, action: () => Promise<unknown>) {
  try {
    return await action();
  } catch (error) {
    const failure = remoteFilesError(error);
    return reply.code(failure.status).send({ code: failure.code, message: failure.message });
  }
}

export function registerRemoteFileActionRoutes(app: FastifyInstance, deps: Deps) {
  const base = '/api/workspaces/:id/remote-files';
  const options = {
    bodyLimit: 16_384,
    onSend: async (_request: unknown, reply: FastifyReply, payload: unknown) => {
      reply.header('Cache-Control', 'no-store');
      return payload;
    },
  };
  app.post(`${base}/sessions/:sessionId/preflights`, options, async (request, reply) =>
    respond(reply, async () => {
      const params = Params.safeParse(request.params);
      const action = Action.safeParse(request.body);
      if (!params.success || !params.data.sessionId || !action.success || !Empty.safeParse(request.query).success)
        throw new RemoteFilesError('invalid_request');
      return deps.preflights.create(params.data.id, params.data.sessionId, action.data, requestSignal(request, reply));
    }),
  );
  app.post(`${base}/tasks`, options, async (request, reply) =>
    respond(reply, async () => {
      const params = Params.safeParse(request.params);
      const input = Submit.safeParse(request.body);
      if (!params.success || !input.success || !Empty.safeParse(request.query).success)
        throw new RemoteFilesError('invalid_request');
      return deps.tasks.submit(params.data.id, input.data.preflightId);
    }),
  );
  app.get(`${base}/tasks`, options, async (request, reply) =>
    respond(reply, async () => {
      const params = Params.safeParse(request.params);
      if (!params.success || !Empty.safeParse(request.query).success) throw new RemoteFilesError('invalid_request');
      return { tasks: await deps.tasks.list(params.data.id) };
    }),
  );
  app.get(`${base}/tasks/:taskId`, options, async (request, reply) =>
    respond(reply, async () => {
      const params = Params.safeParse(request.params);
      if (!params.success || !params.data.taskId || !Empty.safeParse(request.query).success)
        throw new RemoteFilesError('invalid_request');
      return deps.tasks.status(params.data.id, params.data.taskId);
    }),
  );
  for (const action of ['cancel', 'check'] as const) {
    app.post(`${base}/tasks/:taskId/${action}`, options, async (request, reply) =>
      respond(reply, async () => {
        const params = Params.safeParse(request.params);
        if (
          !params.success ||
          !params.data.taskId ||
          !Empty.safeParse(request.query).success ||
          !Empty.safeParse(request.body).success
        )
          throw new RemoteFilesError('invalid_request');
        return deps.tasks[action](params.data.id, params.data.taskId);
      }),
    );
  }
  app.post(`${base}/tasks/:taskId/recover`, options, async (request, reply) =>
    respond(reply, async () => {
      const params = Params.safeParse(request.params);
      if (
        !params.success ||
        !params.data.taskId ||
        !Empty.safeParse(request.query).success ||
        !Recover.safeParse(request.body).success
      )
        throw new RemoteFilesError('invalid_request');
      return deps.tasks.recover(params.data.id, params.data.taskId);
    }),
  );
  app.get(`${base}/sessions/:sessionId/download`, options, async (request, reply) =>
    respond(reply, async () => {
      const params = Params.safeParse(request.params);
      const query = Query.safeParse(request.query);
      if (!params.success || !params.data.sessionId || !query.success) throw new RemoteFilesError('invalid_request');
      const download = await deps.downloads.prepare(
        params.data.id,
        params.data.sessionId,
        query.data.path,
        requestSignal(request, reply),
      );
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Length', download.size);
      reply.header(
        'Content-Disposition',
        `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(download.name).replace(/'/g, '%27')}`,
      );
      return reply.send(download.stream);
    }),
  );
  app.addHook('onClose', async () => deps.tasks.dispose());
}
