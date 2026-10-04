import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { TerminalBindingRequestSchema } from '@ssh-server/shared';
import type { TerminalBindings } from '../terminal/binding';
import type { TerminalManager } from '../terminal/manager';
import { TerminalError, terminalError } from '../terminal/errors';
import { registerTerminalUpgrade } from './terminal-upgrade';
import { requestSignal } from './remote-files.routes';

const Params = z.strictObject({ id: z.string().min(1).max(200) });
const Empty = z.strictObject({});
export function registerTerminalRoutes(
  app: FastifyInstance,
  deps: { terminals: TerminalManager; bindings: TerminalBindings },
): void {
  registerTerminalUpgrade(app);
  app.post('/api/workspaces/:id/terminal-binding', { bodyLimit: 16_384 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const params = Params.safeParse(request.params);
      const body = TerminalBindingRequestSchema.safeParse(request.body);
      if (!params.success || !body.success || !Empty.safeParse(request.query).success)
        throw new TerminalError('invalid_request');
      if (params.data.id !== body.data.target.workspaceId) throw new TerminalError('invalid_request');
      return await deps.bindings.issue(body.data.target, {
        signal: requestSignal(request, reply),
        previousBinding: body.data.previousBinding,
      });
    } catch (error) {
      const failure = terminalError(error);
      return reply.code(failure.status).send({ code: failure.code, message: failure.message });
    }
  });
  app.get('/api/workspaces/:id/terminal', { websocket: true }, (socket, request) => {
    const params = Params.safeParse(request.params);
    if (!params.success || !Empty.safeParse(request.query).success) {
      socket.close(1008);
      return;
    }
    deps.terminals.attach(params.data.id, socket);
  });
  app.addHook('onClose', (_instance, done) => {
    deps.terminals.dispose();
    done();
  });
}
