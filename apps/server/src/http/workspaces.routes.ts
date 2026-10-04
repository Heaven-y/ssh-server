// 工作区与 SSH Host 接口
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SshHostInfo, WorkspaceInput } from '@ssh-server/shared';
import { WorkspaceValidationError, type WorkspaceStore } from '../workspaces/store';
import type { WorkspaceSetup } from '../workspaces/setup/service';
import { createVerifiedWorkspace } from './workspace-setup.routes';

export type WorkspaceRoutesDeps = {
  store: WorkspaceStore;
  listSshHosts(): Promise<SshHostInfo[]>;
  setup?: WorkspaceSetup;
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
      const ws = await store.update(req.params.id, req.body ?? {});
      return ws ? ws : reply.code(404).send({ message: '工作区不存在' });
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/workspaces/:id', async (req, reply) =>
    (await store.remove(req.params.id)) ? reply.code(204).send() : reply.code(404).send({ message: '工作区不存在' }),
  );

  app.get('/api/ssh-hosts', async () => deps.listSshHosts());
}
