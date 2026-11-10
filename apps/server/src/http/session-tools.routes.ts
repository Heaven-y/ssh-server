import { AgentKindSchema } from '@agentdeck/shared/conversation';
import { SessionToolsInputSchema } from '@agentdeck/shared/settings';
import type { FastifyInstance, FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import { z } from 'zod';
import { SessionError } from '../agents/errors';
import { FileAccessError } from '../platform/files/errors';
import { SessionToolsError, type SessionToolsService } from '../settings/session-tools';

export function registerSessionToolsRoutes(app: FastifyInstance, deps: { service: SessionToolsService }) {
  const options = {
    bodyLimit: 2048,
    onRequest: (_request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
      reply.header('Cache-Control', 'no-store');
      done();
    },
    errorHandler: (error: Error & { statusCode?: number }, _request: unknown, reply: FastifyReply) => {
      const known =
        error instanceof SessionToolsError || error instanceof FileAccessError || error instanceof SessionError;
      const failure = known
        ? error
        : new SessionToolsError(error.statusCode && error.statusCode < 500 ? 'invalid_request' : 'io_error');
      void reply.code(failure.status).send({ code: failure.code, message: failure.message });
    },
  };
  const agentOf = (params: unknown, query: unknown) => {
    const parsed = z.strictObject({ agent: AgentKindSchema }).safeParse(params);
    if (!parsed.success || !z.strictObject({}).safeParse(query).success) throw new SessionToolsError('invalid_request');
    return parsed.data.agent;
  };
  app.get('/api/session-tools/:agent', options, (request) => deps.service.read(agentOf(request.params, request.query)));
  app.put('/api/session-tools/:agent', options, (request) => {
    const agent = agentOf(request.params, request.query);
    const input = SessionToolsInputSchema.safeParse(request.body);
    if (!input.success) throw new SessionToolsError('invalid_request');
    return deps.service.save(agent, input.data);
  });
}
