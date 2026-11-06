import { AgentKindSchema, type AgentKind } from '@agentdeck/shared/conversation';
import { LaunchEnvironmentInputSchema } from '@agentdeck/shared/settings';
import type { FastifyInstance, FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import { z } from 'zod';
import { NativeConfigError } from '../agents/common/configuration/legacy-errors';
import type { LaunchEnvironment } from '../settings/launch-environment';

export function registerLaunchEnvironmentRoutes(
  app: FastifyInstance,
  deps: {
    service: LaunchEnvironment;
    restart(agent: AgentKind): Promise<void>;
  },
) {
  const options = {
    bodyLimit: 32768,
    onRequest: (_request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
      reply.header('Cache-Control', 'no-store');
      done();
    },
    errorHandler: (
      error: Error & { statusCode?: number },
      _request: unknown,
      reply: { code(status: number): { send(value: unknown): void } },
    ) => {
      const code = error.statusCode === 413 ? 'too_large' : 'invalid_request';
      const failure =
        error instanceof NativeConfigError
          ? error
          : new NativeConfigError(error.statusCode && error.statusCode < 500 ? code : 'io_error');
      reply.code(failure.status).send({ code: failure.code, message: failure.message });
    },
  };
  const agentOf = (params: unknown, query: unknown) => {
    const parsed = z.strictObject({ agent: AgentKindSchema }).safeParse(params);
    if (!parsed.success || !z.strictObject({}).safeParse(query).success) throw new NativeConfigError('invalid_request');
    return parsed.data.agent;
  };
  app.get('/api/settings/launch-environment/:agent', options, (req) =>
    deps.service.read(agentOf(req.params, req.query)),
  );
  app.put('/api/settings/launch-environment/:agent', options, (req) => {
    const agent = agentOf(req.params, req.query);
    const input = LaunchEnvironmentInputSchema.safeParse(req.body);
    if (!input.success) throw new NativeConfigError('invalid_request');
    return deps.service.save(agent, input.data);
  });
  app.post('/api/settings/launch-environment/:agent/restart', options, async (req, reply) => {
    const agent = agentOf(req.params, req.query);
    if (!z.strictObject({}).safeParse(req.body).success) throw new NativeConfigError('invalid_request');
    try {
      await deps.restart(agent);
    } catch {
      return reply.code(409).send({ code: 'agent_busy', message: 'CLI 正在运行或准备，请结束后再重新启动。' });
    }
    return reply.code(204).send();
  });
}
