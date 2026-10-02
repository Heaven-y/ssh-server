import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { anonymousConfigError, NativeConfigError } from '../settings/errors';
import type { NativeConfigAgent, NativeConfigService } from '../settings/native-config';
import { MAX_CONFIG_BYTES } from '../settings/safe-file';

export type AgentConfigRoutesDeps = { service: NativeConfigService };
const Params = z.object({ agent: z.enum(['claude', 'codex']) }).strict();
const Query = z.object({}).strict();
const Body = z.object({ content: z.string(), revision: z.string().min(1).max(64) }).strict();

function requestAgent(req: FastifyRequest): NativeConfigAgent {
  const params = Params.safeParse(req.params);
  if (!params.success) throw new NativeConfigError('invalid_agent');
  if (!Query.safeParse(req.query).success) throw new NativeConfigError('invalid_request');
  return params.data.agent;
}

async function respond(reply: FastifyReply, operation: () => Promise<unknown>) {
  reply.header('Cache-Control', 'no-store');
  try {
    return await operation();
  } catch (error) {
    const failure = anonymousConfigError(error);
    return reply.code(failure.status).send({ code: failure.code, message: failure.message });
  }
}

export function registerAgentConfigRoutes(app: FastifyInstance, deps: AgentConfigRoutesDeps): void {
  const options: RouteShorthandOptions = {
    // JSON 转义最多占六字节；实际文件大小在服务层按 UTF-8 字节数限制。
    bodyLimit: MAX_CONFIG_BYTES * 6 + 512,
    onSend: async (_req, reply, payload) => {
      reply.header('Cache-Control', 'no-store');
      return payload;
    },
    errorHandler: (error, _req, reply) => {
      // Fastify 的 JSON 解析错误也可能包含请求片段，不能直接返回默认错误。
      const code = error.statusCode === 413 ? 'too_large' : 'invalid_request';
      const failure = new NativeConfigError(error.statusCode && error.statusCode < 500 ? code : 'io_error');
      void reply.code(failure.status).send({ code: failure.code, message: failure.message });
    },
  };
  app.get('/api/agent-config/:agent', options, async (req, reply) =>
    respond(reply, () => deps.service.read(requestAgent(req))),
  );
  app.put('/api/agent-config/:agent', options, async (req, reply) =>
    respond(reply, () => {
      const agent = requestAgent(req);
      const body = Body.safeParse(req.body);
      if (!body.success) throw new NativeConfigError('invalid_request');
      return deps.service.save(agent, body.data);
    }),
  );
}
