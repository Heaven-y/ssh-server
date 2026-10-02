// 网页只提交同步与明确决策；不接收或持久化 SSH 凭据。
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SyncSettingsSchema, type SyncStatus, type Workspace } from '@ssh-server/shared';
import { SshConnectionError } from '../ssh/connection';
import { SyncError } from '../sync/errors';
import type { SyncManager } from '../sync/manager';
import type { WorkspaceStore } from '../workspaces/store';

export type SyncRoutesDeps = {
  store: Pick<WorkspaceStore, 'get' | 'update'>;
  sync: Pick<
    SyncManager,
    'status' | 'sync' | 'initialize' | 'resolveDeletions' | 'acknowledgeConflicts' | 'transaction'
  >;
};
const InitializeBody = z.object({ confirmed: z.literal(true) });
const DeletionsBody = z.object({ decision: z.enum(['confirm', 'reject']) });
const BASE = '/api/workspaces/:id/sync';

export function registerSyncRoutes(app: FastifyInstance, deps: SyncRoutesDeps): void {
  async function workspaceOf(req: FastifyRequest, reply: FastifyReply): Promise<Workspace | undefined> {
    const ws = await deps.store.get((req.params as { id: string }).id);
    if (!ws) await reply.code(404).send({ message: '工作区不存在' });
    return ws;
  }
  async function respond(reply: FastifyReply, operation: () => Promise<SyncStatus>) {
    try {
      return await operation();
    } catch (error) {
      const message =
        error instanceof SyncError || error instanceof SshConnectionError
          ? error.message
          : '同步操作失败，请检查连接及本地配置目录权限';
      return reply.code(409).send({ message });
    }
  }
  app.get(BASE, async (req, reply) => {
    const ws = await workspaceOf(req, reply);
    if (!ws) return reply;
    return respond(reply, () => deps.sync.status(ws));
  });
  app.post(BASE, async (req, reply) => {
    const ws = await workspaceOf(req, reply);
    if (!ws) return reply;
    return respond(reply, () => deps.sync.sync(ws));
  });
  app.post(`${BASE}/initialize`, async (req, reply) => {
    const ws = await workspaceOf(req, reply);
    if (!ws) return reply;
    if (!InitializeBody.safeParse(req.body).success) return reply.code(400).send({ message: '请明确确认初始化或恢复' });
    return respond(reply, () => deps.sync.initialize(ws, true));
  });
  app.post(`${BASE}/deletions`, async (req, reply) => {
    const ws = await workspaceOf(req, reply);
    if (!ws) return reply;
    const body = DeletionsBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: '删除决策必须是 confirm 或 reject' });
    return respond(reply, () => deps.sync.resolveDeletions(ws, body.data.decision));
  });
  app.post(`${BASE}/conflicts/ack`, async (req, reply) => {
    const ws = await workspaceOf(req, reply);
    if (!ws) return reply;
    return respond(reply, () => deps.sync.acknowledgeConflicts(ws));
  });
  app.post(`${BASE}/settings`, async (req, reply) => {
    const ws = await workspaceOf(req, reply);
    if (!ws) return reply;
    const body = SyncSettingsSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ message: '同步阈值或扩展名规则不合法' });
    return respond(reply, () =>
      deps.sync.transaction(ws, async () => {
        const updated = await deps.store.update(ws.id, { sync: body.data });
        if (!updated) throw new SyncError('workspace_missing', '工作区已删除');
        return deps.sync.status(updated);
      }),
    );
  });
}
