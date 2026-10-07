// 网页独立认证接口：仅返回状态，密码不经过工作区存储或 Agent。
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { SshConnectionError } from '../ssh/connection';
import { CredentialStorageError } from '../ssh/credential-storage-error';
import type { SshPool } from '../ssh/pool';
import type { ServerProfiles } from '../ssh/profiles';
import { ServerTargetsError } from '../ssh/targets';

const HostBody = z.strictObject({ sshHost: z.string().min(1).max(200) });
const ConnectBody = HostBody.extend({
  password: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\r\n\0]+$/)
    .optional(),
  savePassword: z.boolean().optional(),
});
const ClearBody = HostBody.extend({ savePassword: z.literal(false) });
type Deps = {
  pool: Pick<SshPool, 'connect' | 'credentialStatus' | 'clearSavedPassword' | 'disconnect' | 'generation'>;
  profiles: Pick<ServerProfiles, 'connection'>;
};
function failure(reply: FastifyReply, error: unknown) {
  if (error instanceof ServerTargetsError)
    return reply.code(error.status).send({ code: error.code, message: error.message });
  if (error instanceof SshConnectionError || error instanceof CredentialStorageError) {
    const status = error.code === 'remote_directory_unavailable' ? 502 : 409;
    return reply.code(status).send({ code: error.code, message: error.message });
  }
  return reply
    .code(502)
    .send({ code: 'connection_failed', message: 'SSH 连接或本机凭据操作失败，请检查网络与连接配置' });
}
export function registerSshRoutes(app: FastifyInstance, { pool, profiles }: Deps): void {
  app.post('/api/ssh/connect', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = ConnectBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: '连接参数不合法' });
    const input = parsed.data;
    const changing = input.password !== undefined || input.savePassword !== undefined;
    let generation: number | undefined;
    let cancelled = false;
    const cancel = () => {
      if (reply.raw.writableEnded) return;
      cancelled = true;
      if (generation !== undefined) pool.disconnect(input.sshHost, generation);
    };
    reply.raw.once('close', cancel);
    try {
      return await profiles.connection(input.sshHost, changing, async () => {
        const status = await pool.credentialStatus(input.sshHost);
        if (cancelled) throw new SshConnectionError('connection_cancelled', '连接请求已取消');
        const pending = pool.connect(input);
        // 普通连接检查取消不能结束其他工作区已经复用的连接。
        if (changing || !status.connected) generation = pool.generation(input.sshHost);
        return pending;
      });
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
      return await profiles.connection(parsed.data.sshHost, true, () => pool.clearSavedPassword(parsed.data.sshHost));
    } catch (error) {
      return failure(reply, error);
    }
  });
  app.post('/api/ssh/disconnect', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = HostBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: '需要 SSH Host' });
    try {
      await profiles.connection(parsed.data.sshHost, true, () => {
        pool.disconnect(parsed.data.sshHost);
        return Promise.resolve();
      });
      return reply.code(204).send();
    } catch (error) {
      return failure(reply, error);
    }
  });
}
