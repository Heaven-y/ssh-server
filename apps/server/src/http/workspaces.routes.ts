// 工作区与 SSH Host 接口
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SshHostInfo, WorkspaceInput } from '@ssh-server/shared';
import { WorkspaceValidationError, type WorkspaceStore } from '../workspaces/store';
import type { WorkspaceSetup } from '../workspaces/setup/service';
import { createVerifiedWorkspace } from './workspace-setup.routes';
import { WorkspaceRemovalInputSchema } from '@ssh-server/shared';
import type { WorkspaceRemoval } from '../workspaces/removal';
import { WorkspaceRemovalError } from '../workspaces/activity';

export type WorkspaceRoutesDeps = {
  store: WorkspaceStore;
  listSshHosts(): Promise<SshHostInfo[]>;
  setup?: WorkspaceSetup;
  removal?: WorkspaceRemoval;
};

/** 校验错误转为 400 { field, message }，其他错误交给 Fastify 默认处理 */
async function withValidation<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof WorkspaceValidationError) return reply.code(400).send({ field: e.field, message: e.message });
    throw e;
  }
}

export function registerWorkspaceRoutes(app: FastifyInstance, deps: WorkspaceRoutesDeps): void {
  const { store } = deps;

  app.get('/api/workspaces', async () => store.list());

  app.post<{ Body: WorkspaceInput }>('/api/workspaces', async (req, reply) =>
    deps.setup
      ? createVerifiedWorkspace(deps.setup, req, reply.code(201))
      : withValidation(reply, async () => reply.code(201).send(await store.create(req.body))),
  );

  app.patch<{ Params: { id: string }; Body: Partial<WorkspaceInput> }>('/api/workspaces/:id', async (req, reply) =>
    withValidation(reply, async () => {
      if (req.body && Object.hasOwn(req.body, 'policy'))
        return reply.code(400).send({ field: 'policy', message: '请通过命令规则接口读取当前版本后保存' });
      const ws = await store.update(req.params.id, req.body ?? {});
      return ws ? ws : reply.code(404).send({ message: '工作区不存在' });
    }),
  );

  app.get<{ Params: { id: string } }>('/api/workspaces/:id/removal', async (req, reply) => {
    if (!deps.removal) return reply.code(503).send({ message: '工作区移除服务尚未接入' });
    return withRemoval(reply, () => deps.removal!.preview(req.params.id));
  });
  app.delete<{ Params: { id: string } }>('/api/workspaces/:id', async (req, reply) => {
    if (!deps.removal)
      return (await store.remove(req.params.id))
        ? reply.code(204).send()
        : reply.code(404).send({ message: '工作区不存在' });
    const parsed = WorkspaceRemovalInputSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ code: 'workspace_confirmation_required', message: '请读取当前配置并明确确认移除' });
    return withRemoval(reply, () => deps.removal!.remove(req.params.id, parsed.data));
  });

  app.get('/api/ssh-hosts', async () => deps.listSshHosts());
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
