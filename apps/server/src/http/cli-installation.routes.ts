import { AgentKindSchema } from '@agentdeck/shared/conversation';
import { CliInstallInputSchema } from '@agentdeck/shared/settings';
import type { FastifyInstance, FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import { z } from 'zod';
import type { CliInstallationService } from '../cli-installation/service';
import { CliInstallationError, installationFailure } from '../cli-installation/service-errors';

const empty = z.strictObject({});
function agentOf(request: FastifyRequest) {
  const parsed = z.strictObject({ agent: AgentKindSchema }).safeParse(request.params);
  if (!parsed.success || !empty.safeParse(request.query).success) throw new CliInstallationError('invalid_request');
  return parsed.data.agent;
}

function safeError(error: Error & { statusCode?: number }, _request: FastifyRequest, reply: FastifyReply): void {
  let failure = installationFailure(error);
  if (!(error instanceof CliInstallationError) && error.statusCode && error.statusCode < 500) {
    failure = new CliInstallationError(error.statusCode === 413 ? 'too_large' : 'invalid_request');
  }
  reply.code(failure.status).send({ code: failure.code, message: failure.message });
}

export function registerCliInstallationRoutes(app: FastifyInstance, deps: { service: CliInstallationService }) {
  const options = {
    bodyLimit: 1024,
    onRequest: (_request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
      reply.header('Cache-Control', 'no-store');
      done();
    },
    errorHandler: safeError,
  };
  app.get('/api/settings/cli-installation/:agent', options, (request) => deps.service.read(agentOf(request)));
  app.post('/api/settings/cli-installation/:agent/check', options, (request) => {
    const agent = agentOf(request);
    if (!empty.safeParse(request.body).success) throw new CliInstallationError('invalid_request');
    return deps.service.check(agent);
  });
  app.post('/api/settings/cli-installation/:agent/operations', options, async (request, reply) => {
    const agent = agentOf(request);
    const input = CliInstallInputSchema.safeParse(request.body);
    if (!input.success) throw new CliInstallationError('invalid_request');
    const status = await deps.service.start(agent, input.data);
    return reply.code(202).send(status);
  });
}
