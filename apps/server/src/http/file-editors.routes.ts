import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { FileEditorMessageSchema } from '@ssh-server/shared';
import type { EditorPeer, FileEditors } from '../files/editors';
import { RemoteFilesError, remoteFilesError } from '../remote-files/errors';
import type { WorkspaceStore } from '../workspaces/store';

const Params = z.object({ id: z.string().min(1), editorId: z.string().uuid().optional() }).strict();
const Confirm = z.object({ confirmed: z.literal(true) }).strict();
const Empty = z.object({}).strict();

export function registerFileEditorRoutes(
  app: FastifyInstance,
  deps: {
    store: Pick<WorkspaceStore, 'get'>;
    editors: FileEditors;
    acquireWorkspace?: (id: string) => () => void;
  },
) {
  const base = '/api/workspaces/:id/file-editors';
  const options = {
    onSend: async (_request: unknown, reply: FastifyReply, payload: unknown) => {
      reply.header('Cache-Control', 'no-store');
      return payload;
    },
  };
  app.get(base, options, async (request, reply) => {
    try {
      const params = Params.parse(request.params);
      if (!Empty.safeParse(request.query).success) throw new RemoteFilesError('invalid_request');
      return { editors: await deps.editors.disconnected(params.id) };
    } catch (error) {
      const failure = remoteFilesError(error);
      return reply.code(failure.status).send({ code: failure.code, message: failure.message });
    }
  });
  app.delete(`${base}/:editorId`, options, async (request, reply) => {
    try {
      const params = Params.safeParse(request.params);
      if (
        !params.success ||
        !params.data.editorId ||
        !Confirm.safeParse(request.body).success ||
        !Empty.safeParse(request.query).success
      )
        throw new RemoteFilesError('invalid_request');
      await deps.editors.forget(params.data.id, params.data.editorId);
      return { forgotten: true };
    } catch (error) {
      const failure = remoteFilesError(error);
      return reply.code(failure.status).send({ code: failure.code, message: failure.message });
    }
  });
  app.get(`${base}/:editorId`, { websocket: true }, (ws, request) => {
    const peer: EditorPeer = {
      send: (message) => {
        if (ws.readyState === 1) ws.send(JSON.stringify(message));
      },
    };
    const params = Params.safeParse(request.params);
    if (!params.success || !params.data.editorId || !Empty.safeParse(request.query).success) {
      ws.close(1008);
      return;
    }
    const { id, editorId } = params.data;
    const fail = (error: unknown) => {
      peer.send({ type: 'error', message: remoteFilesError(error).message });
      ws.close(1008);
    };
    let pending = (async () => {
      const release = deps.acquireWorkspace?.(id);
      try {
        if (!(await deps.store.get(id))) throw new RemoteFilesError('workspace_missing');
        await deps.editors.attach(editorId, id, peer);
      } finally {
        release?.();
      }
    })();
    void pending.catch(fail);
    ws.on('message', (data) => {
      const run = pending.then(async () => {
        const source = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        if (source.byteLength > 16_384) throw new RemoteFilesError('invalid_request');
        const message = FileEditorMessageSchema.safeParse(JSON.parse(source.toString('utf8')));
        if (!message.success) throw new RemoteFilesError('invalid_request');
        await deps.editors.receive(editorId, peer, message.data);
      });
      pending = run;
      void run.catch(fail);
    });
    ws.on('close', () => {
      void pending.finally(() => deps.editors.detach(editorId, peer)).catch(() => undefined);
    });
    ws.on('error', () => {
      ws.close();
    });
  });
}
