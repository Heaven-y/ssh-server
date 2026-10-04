import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HostTrustConfirmationSchema } from '@ssh-server/shared';
import { HostTrustError, type HostTrust } from '../ssh/host-trust';
import { SshConnectionError } from '../ssh/connection';

const AliasSchema = z.object({ sshHost: z.string().min(1).max(200) }).strict();
async function respond(req: FastifyRequest, reply: FastifyReply, operation: (signal: AbortSignal) => Promise<unknown>) {
  const controller = new AbortController();
  const cancel = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  reply.raw.once('close', cancel);
  reply.header('Cache-Control', 'no-store');
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (error instanceof HostTrustError || error instanceof SshConnectionError)
      return reply.code(409).send({ code: error.code, message: error.message });
    return reply
      .code(502)
      .send({ code: 'host_trust_unavailable', message: '本机指纹检查不可用，请检查连接配置后重试' });
  } finally {
    reply.raw.off('close', cancel);
  }
}
export function registerHostTrustRoutes(app: FastifyInstance, trust: HostTrust) {
  app.post('/api/ssh/host-key', async (req, reply) => {
    const parsed = AliasSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: '服务器指纹目标不合法' });
    return respond(req, reply, (signal) => trust.probe(parsed.data.sshHost, signal));
  });
  app.post('/api/ssh/host-key/confirm', async (req, reply) => {
    const parsed = HostTrustConfirmationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: '需要明确核对本次指纹后确认' });
    return respond(req, reply, (signal) => trust.confirm(parsed.data, signal));
  });
  app.addHook('preClose', () => trust.dispose());
}
