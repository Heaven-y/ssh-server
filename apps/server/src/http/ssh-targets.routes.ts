import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ManagedServerSchema, ManualServerInputSchema } from '@ssh-server/shared';
import { ServerTargetsError } from '../ssh/targets';
import type { ServerProfiles } from '../ssh/profiles';

const Update = z.strictObject({ input: ManualServerInputSchema, expected: ManagedServerSchema });
const Remove = z.strictObject({ expected: ManagedServerSchema, confirmed: z.literal(true) });
const Params = z.strictObject({ alias: ManagedServerSchema.shape.alias });
async function respond(reply: FastifyReply, operation: () => Promise<unknown>) {
  reply.header('Cache-Control', 'no-store');
  try {
    return await operation();
  } catch (error) {
    const failure = error instanceof ServerTargetsError ? error : new ServerTargetsError('target_storage_failed');
    return reply.code(failure.status).send({ code: failure.code, message: failure.message });
  }
}
export function registerSshTargetRoutes(app: FastifyInstance, profiles: ServerProfiles) {
  const options = {
    errorHandler: (_error: unknown, _request: unknown, reply: FastifyReply) => {
      void reply.code(400).send({ code: 'invalid_target', message: '服务器请求格式不合法' });
    },
  };
  app.get('/api/ssh-targets', (_req, reply) => respond(reply, () => profiles.list()));
  app.get('/api/ssh-targets/import-options', (_req, reply) => respond(reply, () => profiles.importOptions()));
  app.post('/api/ssh-targets', options, (req, reply) => respond(reply, () => profiles.save(req.body)));
  app.put('/api/ssh-targets/:alias', options, (req, reply) =>
    respond(reply, async () => {
      const params = Params.safeParse(req.params);
      const parsed = Update.safeParse(req.body);
      if (!params.success || !parsed.success) throw new ServerTargetsError('invalid_target');
      // expected 是完整快照，不能通过默认值、trim 或大小写转换补齐/改写后再比较。
      const { expected } = req.body as z.infer<typeof Update>;
      return profiles.update(params.data.alias, parsed.data.input, expected);
    }),
  );
  app.delete('/api/ssh-targets/:alias', options, (req, reply) =>
    respond(reply, async () => {
      const params = Params.safeParse(req.params);
      const parsed = Remove.safeParse(req.body);
      if (!params.success || !parsed.success) throw new ServerTargetsError('invalid_target');
      const { expected } = req.body as z.infer<typeof Remove>;
      await profiles.remove(params.data.alias, expected);
      return reply.code(204).send();
    }),
  );
}
