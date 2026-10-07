// 工作区接口；服务器档案由独立路由统一管理。
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { WorkspaceStore } from '../workspaces/store';
import type { WorkspaceSetup } from '../workspaces/setup/service';
import { createVerifiedWorkspace } from './workspace-setup.routes';
import { WorkspaceRemovalInputSchema } from '@ssh-server/shared';
import type { WorkspaceRemoval } from '../workspaces/removal';
import { WorkspaceRemovalError } from '../workspaces/activity';

export type WorkspaceRoutesDeps = {
  store: WorkspaceStore;
  setup?: WorkspaceSetup;
  removal?: WorkspaceRemoval;
};

export function registerWorkspaceRoutes(app: FastifyInstance, deps: WorkspaceRoutesDeps): void {
  const { store } = deps;

  app.get('/api/workspaces', async () => store.list());

  app.post('/api/workspaces', async (req, reply) => {
    if (!deps.setup) return reply.code(503).send({ message: '工作区创建服务不可用' });
    return createVerifiedWorkspace(deps.setup, req, reply.code(201));
  });

  app.get<{ Params: { id: string } }>('/api/workspaces/:id/removal', async (req, reply) => {
    if (!deps.removal) return reply.code(503).send({ message: '工作区移除服务不可用' });
    return withRemoval(reply, () => deps.removal!.preview(req.params.id));
  });
  app.delete<{ Params: { id: string } }>('/api/workspaces/:id', async (req, reply) => {
    if (!deps.removal) return reply.code(503).send({ message: '工作区移除服务不可用' });
    const parsed = WorkspaceRemovalInputSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ code: 'workspace_confirmation_required', message: '请读取当前配置并明确确认移除' });
    return withRemoval(reply, () => deps.removal!.remove(req.params.id, parsed.data));
  });
}

async function withRemoval<T>(reply: FastifyReply, operation: () => Promise<T>) {
  reply.header('Cache-Control', 'no-store');
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof WorkspaceRemovalError)) throw error;
    return reply.code(error.status).send({ code: error.code, message: error.message });
  }
}
