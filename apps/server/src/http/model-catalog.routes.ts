import os from 'node:os';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AgentKindSchema } from '@agentdeck/shared/conversation';
import type { CapabilitiesService } from '../chat/capabilities';
import { SessionError } from '../agents/errors';
import type { WorkspaceStore } from '../workspaces/store';
type Deps = { capabilities: CapabilitiesService; store: Pick<WorkspaceStore, 'get'>; homeDir?: string };
async function catalogDirectory(deps: Deps, projectId?: string) {
  if (!projectId) return deps.homeDir ?? os.homedir();
  const project = await deps.store.get(projectId);
  if (!project) throw new SessionError(404, 'project_missing', '工作区不存在');
  return project.dir;
}

/** 设置中的模型目录与对话菜单共用缓存；GET 不启动原生发现。 */
export function registerModelCatalogRoutes(app: FastifyInstance, deps: Deps) {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/settings/models/:agent/catalog',
    handler: async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const params = z.strictObject({ agent: AgentKindSchema }).safeParse(req.params);
      const query = z.strictObject({ projectId: z.string().min(1).max(100).optional() }).safeParse(req.query);
      if (!params.success || !query.success) return reply.code(400).send({ message: '模型目录请求格式不正确' });
      const controller = new AbortController();
      const closed = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      reply.raw.once('close', closed);
      try {
        const directory = await catalogDirectory(deps, query.data.projectId);
        return req.method === 'POST'
          ? await deps.capabilities.refreshDirectory(directory, params.data.agent, controller.signal)
          : await deps.capabilities.readDirectory(directory, params.data.agent);
      } catch (error) {
        const failure =
          error instanceof SessionError
            ? error
            : new SessionError(503, 'capabilities_unavailable', '暂时无法读取模型。');
        return reply.code(failure.status).send({ code: failure.code, message: failure.message });
      } finally {
        reply.raw.off('close', closed);
      }
    },
  });
}
