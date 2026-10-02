// 网页独立认证接口：密码不经过工作区存储或 Agent。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SshAuthModeSchema, WorkspaceInputSchema } from '@ssh-server/shared';
import { SshConnectionError } from '../ssh/connection';
import type { SshPool } from '../ssh/pool';
import { buildRemoteCommand } from '../ssh/remote-command';

const ConnectBody = z
  .object({
    sshHost: z.string().min(1).max(200),
    authMode: SshAuthModeSchema,
    remoteDir: WorkspaceInputSchema.shape.remoteDir,
    password: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[^\r\n\0]+$/)
      .optional(),
  })
  .refine((body) => body.authMode === 'password' || body.password === undefined);
const DisconnectBody = z.object({ sshHost: z.string().min(1).max(200) });

type Deps = { pool: Pick<SshPool, 'exec' | 'setPassword' | 'disconnect' | 'generation'> };
export function registerSshRoutes(app: FastifyInstance, { pool }: Deps): void {
  const clearTemporary = (alias: string, generation: number | undefined, supplied: boolean) => {
    if (supplied && generation !== undefined) pool.disconnect(alias, generation);
  };
  app.post('/api/ssh/connect', async (req, reply) => {
    const parsed = ConnectBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: '连接参数不合法' });
    const { sshHost, authMode, remoteDir, password } = parsed.data;
    let generation: number | undefined;
    try {
      if (password !== undefined) await pool.setPassword(sshHost, password);
      generation = pool.generation(sshHost);
      const result = await pool.exec(
        { alias: sshHost, authMode },
        buildRemoteCommand(remoteDir, 'test -d . && test -r . && test -x .', 20),
        { localTimeoutMs: 30_000, outputCap: 1000 },
      );
      if (generation !== pool.generation(sshHost))
        throw new SshConnectionError('connection_cancelled', '连接认证周期已结束，请重新连接');
      if (result.exitCode !== 0 || result.timedOut) {
        clearTemporary(sshHost, generation, password !== undefined);
        return reply
          .code(502)
          .send({ code: 'remote_directory_unavailable', message: '服务器目录不存在、无法进入或连接测试超时' });
      }
      return { connected: true, authMode };
    } catch (error) {
      clearTemporary(sshHost, generation, password !== undefined);
      if (error instanceof SshConnectionError)
        return reply.code(409).send({ code: error.code, message: error.message });
      return reply.code(502).send({ code: 'connection_failed', message: 'SSH 连接测试失败，请检查网络与连接配置' });
    }
  });
  app.post('/api/ssh/disconnect', async (req, reply) => {
    const parsed = DisconnectBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: '需要 SSH Host' });
    pool.disconnect(parsed.data.sshHost);
    return reply.code(204).send();
  });
}
