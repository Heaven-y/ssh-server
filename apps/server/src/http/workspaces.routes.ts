// 工作区接口；服务器档案由独立路由统一管理。
// 项目与会话的完整接口在后续任务重写，这里只保留当前仍被前端使用的列表读取。
import type { FastifyInstance } from 'fastify';
import type { WorkspaceStore } from '../workspaces/store';

export type WorkspaceRoutesDeps = {
  store: WorkspaceStore;
};

export function registerWorkspaceRoutes(app: FastifyInstance, deps: WorkspaceRoutesDeps): void {
  app.get('/api/workspaces', async () => deps.store.list());
}
