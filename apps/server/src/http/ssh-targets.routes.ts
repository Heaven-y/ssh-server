import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { ManagedServerSchema, ManualServerInputSchema } from '@ssh-server/shared';
import { ServerTargetsError } from '../ssh/targets';
import type { ServerProfiles } from '../ssh/profiles';
import { CredentialStorageError } from '../ssh/credential-storage-error';
import { SshConnectionError } from '../ssh/connection';

const Update = z.strictObject({ input: ManualServerInputSchema, expected: ManagedServerSchema });
const Remove = z.strictObject({ expected: ManagedServerSchema, confirmed: z.literal(true) });
const Params = z.strictObject({ alias: ManagedServerSchema.shape.alias });
const Empty = z.strictObject({});
const ReadPassword = z.strictObject({ expected: ManagedServerSchema });
const Password = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\r\n\0]+$/);
const SavePassword = Update.extend({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  password: Password.nullable().optional(),
  confirmed: z.literal(true),
}).refine((value) => value.password === undefined || value.input.authMode === 'password');
const CreateWithPassword = z
  .strictObject({ input: ManualServerInputSchema, password: Password, confirmed: z.literal(true) })
  .refine((value) => value.input.authMode === 'password');
async function respond(reply: FastifyReply, operation: () => Promise<unknown>) {
  reply.header('Cache-Control', 'no-store');
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CredentialStorageError || error instanceof SshConnectionError)
      return reply.code(409).send({ code: error.code, message: error.message });
    const failure = error instanceof ServerTargetsError ? error : new ServerTargetsError('target_storage_failed');
    return reply.code(failure.status).send({ code: failure.code, message: failure.message });
  }
}

const credentialOptions: RouteShorthandOptions = {
  bodyLimit: 32_768,
  logLevel: 'silent',
  // onSend也覆盖全局本机会话/Origin钩子提前拒绝的响应。
  onSend: (_req, reply, payload, done) => {
    reply.header('Cache-Control', 'no-store');
    done(null, payload);
  },
  errorHandler: (_error, _req, reply) => {
    void reply
      .header('Cache-Control', 'no-store')
      .code(400)
      .send({ code: 'invalid_target', message: '服务器编辑请求格式不合法' });
  },
};
async function credentialRequest(
  req: FastifyRequest,
  reply: FastifyReply,
  operation: (current: () => boolean) => Promise<unknown>,
) {
  let cancelled = req.raw.aborted;
  const cancel = () => {
    if (!reply.raw.writableEnded) cancelled = true;
  };
  reply.raw.once('close', cancel);
  try {
    return await respond(reply, () => {
      if (!Empty.safeParse(req.query).success) throw new ServerTargetsError('invalid_target');
      return operation(() => !cancelled);
    });
  } finally {
    reply.raw.off('close', cancel);
  }
}
function registerPasswordEditorRoutes(app: FastifyInstance, profiles: ServerProfiles) {
  app.post('/api/ssh-targets/:alias/password/read', credentialOptions, (req, reply) =>
    credentialRequest(req, reply, (current) => {
      const params = Params.safeParse(req.params);
      const parsed = ReadPassword.safeParse(req.body);
      if (!params.success || !parsed.success) throw new ServerTargetsError('invalid_target');
      const { expected } = req.body as z.infer<typeof ReadPassword>;
      return profiles.readPassword(params.data.alias, expected, current);
    }),
  );
  app.put('/api/ssh-targets/:alias/password', credentialOptions, (req, reply) =>
    credentialRequest(req, reply, (current) => {
      const params = Params.safeParse(req.params);
      const parsed = SavePassword.safeParse(req.body);
      if (!params.success || !parsed.success) throw new ServerTargetsError('invalid_target');
      const { expected } = req.body as z.infer<typeof SavePassword>;
      return profiles.edit(params.data.alias, { ...parsed.data, expected }, current);
    }),
  );
  app.post('/api/ssh-targets/with-password', credentialOptions, (req, reply) =>
    credentialRequest(req, reply, (current) => {
      const parsed = CreateWithPassword.safeParse(req.body);
      if (!parsed.success) throw new ServerTargetsError('invalid_target');
      return profiles.createWithPassword(parsed.data.input, parsed.data.password, current);
    }),
  );
}
export function registerSshTargetRoutes(app: FastifyInstance, profiles: ServerProfiles) {
  registerPasswordEditorRoutes(app, profiles);
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
