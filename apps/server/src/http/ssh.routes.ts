// 网页独立认证接口：仅返回保存状态，密码不经过工作区存储或 Agent。
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { SshAuthModeSchema, WorkspaceInputSchema } from '@ssh-server/shared';
import { SshConnectionError } from '../ssh/connection';
import { CredentialStorageError } from '../ssh/credential-storage-error';
import type { SshPool } from '../ssh/pool';

const HostBody = z.object({ sshHost: z.string().min(1).max(200) });
const ConnectBody = HostBody.extend({
  authMode: SshAuthModeSchema,
  remoteDir: WorkspaceInputSchema.shape.remoteDir,
  password: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\r\n\0]+$/)
    .optional(),
  savePassword: z.boolean().optional(),
}).refine((body) => body.authMode === 'password' || body.password === undefined);
const ClearBody = HostBody.extend({ savePassword: z.literal(false) });
type Deps = {
  pool: Pick<SshPool, 'connect' | 'credentialStatus' | 'clearSavedPassword' | 'disconnect' | 'generation'>;
};

function failure(reply: FastifyReply, error: unknown) {
  if (error instanceof SshConnectionError || error instanceof CredentialStorageError) {
    const status = error.code === 'remote_directory_unavailable' ? 502 : 409;
    return reply.code(status).send({ code: error.code, message: error.message });
  }
  return reply
    .code(502)
    .send({ code: 'connection_failed', message: 'SSH 连接或本机凭据操作失败，请检查网络与连接配置' });
}
export function registerSshRoutes(app: FastifyInstance, { pool }: Deps): void {
  app.post('/api/ssh/connect', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = ConnectBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: '连接参数不合法' });
    const pending = pool.connect(parsed.data);
    const generation = pool.generation(parsed.data.sshHost);
    const cancel = () => {
      if (!reply.raw.writableEnded) pool.disconnect(parsed.data.sshHost, generation);
    };
    reply.raw.once('close', cancel);
    try {
      return await pending;
    } catch (error) {
      return failure(reply, error);
    } finally {
      reply.raw.off('close', cancel);
    }
  });
  app.get('/api/ssh/credentials', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = HostBody.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ message: '需要 SSH Host' });
    try {
      return await pool.credentialStatus(parsed.data.sshHost);
    } catch (error) {
      return failure(reply, error);
    }
  });
  app.put('/api/ssh/credentials', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = ClearBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: '取消保存参数不合法' });
    try {
      return await pool.clearSavedPassword(parsed.data.sshHost);
    } catch (error) {
      return failure(reply, error);
    }
  });
  app.post('/api/ssh/disconnect', async (req, reply) => {
    const parsed = HostBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: '需要 SSH Host' });
    pool.disconnect(parsed.data.sshHost);
    return reply.code(204).send();
  });
}
