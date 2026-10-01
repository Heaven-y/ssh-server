// 内部接口：只给 remote-tools MCP 子进程调用，用会话令牌鉴权
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Workspace } from '@ssh-server/shared';
import type { SessionRegistry } from '../chat/registry';
import { checkCommand } from '../policy/policy';
import type { SshPool } from '../ssh/pool';
import {
  buildPeekCommand,
  buildRemoteCommand,
  EXEC_DEFAULT_TIMEOUT_SEC,
  EXEC_GRACE_SEC,
  EXEC_MAX_TIMEOUT_SEC,
  OUTPUT_CAP_BYTES,
} from '../ssh/remote-command';

export type InternalRoutesDeps = {
  registry: SessionRegistry;
  getWorkspace(id: string): Promise<Workspace | undefined>;
  pool: Pick<SshPool, 'exec'>;
};

const ExecBody = z.object({
  command: z.string().min(1).max(100_000),
  timeoutSec: z.number().int().positive().optional(),
});

const PeekBody = z.object({
  path: z.string().min(1),
  action: z.enum(['stat', 'head', 'tail', 'du']),
  lines: z.number().int().min(1).max(200).optional(),
});

const PEEK_LOCAL_TIMEOUT_MS = 60_000;

export function registerInternalRoutes(app: FastifyInstance, deps: InternalRoutesDeps): void {
  /** Bearer 令牌 → 工作区；失败时已回复 401 / 404 */
  async function workspaceOf(req: FastifyRequest, reply: FastifyReply): Promise<Workspace | undefined> {
    const auth = req.headers.authorization ?? '';
    const workspaceId = auth.startsWith('Bearer ') ? deps.registry.resolve(auth.slice(7)) : undefined;
    if (!workspaceId) {
      await reply.code(401).send({ message: '会话令牌无效' });
      return undefined;
    }
    const ws = await deps.getWorkspace(workspaceId);
    if (!ws) await reply.code(404).send({ message: '工作区不存在' });
    return ws;
  }

  /** SSH 层的错误作为结果返回，让 Agent 看到原因 */
  async function run(ws: Workspace, cmd: string, localTimeoutMs: number) {
    try {
      return await deps.pool.exec(ws.sshHost, cmd, { localTimeoutMs, outputCap: OUTPUT_CAP_BYTES });
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  app.post('/internal/remote-exec', async (req, reply) => {
    const ws = await workspaceOf(req, reply);
    if (!ws) return reply;
    const body = ExecBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: '参数不合法：需要 command' });

    const decision = checkCommand(body.data.command, { remoteRoot: ws.remoteDir, disabledRules: ws.policy?.disabledRules });
    if (!decision.allowed) return { denied: { ruleId: decision.ruleId, reason: decision.reason } };

    const timeoutSec = Math.min(body.data.timeoutSec ?? EXEC_DEFAULT_TIMEOUT_SEC, EXEC_MAX_TIMEOUT_SEC);
    const cmd = buildRemoteCommand(ws.remoteDir, body.data.command, timeoutSec);
    return run(ws, cmd, (timeoutSec + EXEC_GRACE_SEC) * 1000);
  });

  app.post('/internal/remote-peek', async (req, reply) => {
    const ws = await workspaceOf(req, reply);
    if (!ws) return reply;
    const body = PeekBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: '参数不合法：path、action 必填，lines 为 1 到 200' });
    const cmd = buildPeekCommand(ws.remoteDir, body.data.path, body.data.action, body.data.lines);
    return run(ws, cmd, PEEK_LOCAL_TIMEOUT_MS);
  });
}
