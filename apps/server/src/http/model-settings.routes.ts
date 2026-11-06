import { AgentKindSchema } from '@agentdeck/shared/conversation';
import { NativeModelSettingsInputSchema } from '@agentdeck/shared/settings';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { NativeResourceError, resourceError } from '../agents/common/configuration/errors';
import { ModelSettingsError } from '../agents/common/configuration/patch';
import type { ModelSettingsService } from '../settings/model-settings';

const Params = z.strictObject({ agent: AgentKindSchema });
function agentOf(req: FastifyRequest) {
  const parsed = Params.safeParse(req.params);
  if (!parsed.success || !z.strictObject({}).safeParse(req.query).success)
    throw new NativeResourceError('invalid_request');
  return parsed.data.agent;
}
async function respond(reply: FastifyReply, operation: () => Promise<unknown>) {
  try {
    return await operation();
  } catch (error) {
    const failure = error instanceof ModelSettingsError ? error : resourceError(error);
    return reply.code(failure.status).send({ code: failure.code, message: failure.message });
  }
}
export function registerModelSettingsRoutes(app: FastifyInstance, service: ModelSettingsService) {
  const options: RouteShorthandOptions = {
    bodyLimit: 65536,
    onSend: async (_req, reply, payload) => {
      reply.header('Cache-Control', 'no-store');
      return payload;
    },
    errorHandler: (error, _req, reply) => {
      const failure = new NativeResourceError(error.statusCode === 413 ? 'too_large' : 'invalid_request');
      void reply.code(failure.status).send({ code: failure.code, message: failure.message });
    },
  };
  app.get('/api/settings/models/:agent', options, (req, reply) => respond(reply, () => service.read(agentOf(req))));
  app.put('/api/settings/models/:agent', options, (req, reply) =>
    respond(reply, () => {
      const agent = agentOf(req);
      const input = NativeModelSettingsInputSchema.safeParse(req.body);
      if (!input.success) throw new NativeResourceError('invalid_request');
      return service.save(agent, input.data);
    }),
  );
}
