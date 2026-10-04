// 组装 Fastify 应用：WebSocket 插件、访问控制、登录、工作区接口、静态页面
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SshHostInfo } from '@ssh-server/shared';
import type { WorkspaceStore } from '../workspaces/store';
import { registerAuthRoute } from './auth';
import { registerSecurity } from './security';
import { registerWorkspaceRoutes } from './workspaces.routes';
import type { WorkspaceSetup } from '../workspaces/setup/service';
import type { WorkspaceActivity } from '../workspaces/activity';
import type { WorkspaceRemoval } from '../workspaces/removal';
import { registerWorkspaceActivity } from './workspace-activity';

export type AppDeps = {
  token: string;
  port: number;
  devOrigin?: string;
  store: WorkspaceStore;
  listSshHosts(): Promise<SshHostInfo[]>;
  setup?: WorkspaceSetup;
  activity?: WorkspaceActivity;
  removal?: WorkspaceRemoval;
  /** 前端构建产物目录，存在时托管静态文件 */
  webDir?: string;
  /** 注册其余路由（内部接口、会话接口、/ws） */
  routes?: (app: FastifyInstance) => void | Promise<void>;
};

const API_PREFIXES = ['/api/', '/internal/', '/ws', '/auth'];

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  await app.register(fastifyWebsocket, { options: { maxPayload: 1024 * 1024 } });

  registerSecurity(app, { token: deps.token, port: deps.port, devOrigin: deps.devOrigin });
  registerAuthRoute(app, deps.token);
  if (deps.activity) registerWorkspaceActivity(app, deps.activity);
  registerWorkspaceRoutes(app, {
    store: deps.store,
    listSshHosts: () => deps.listSshHosts(),
    setup: deps.setup,
    removal: deps.removal,
  });
  await deps.routes?.(app);

  if (deps.webDir && existsSync(deps.webDir)) {
    await app.register(fastifyStatic, { root: deps.webDir });
    // 前端路由回退到 index.html；接口路径保持 404
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?', 1)[0]!;
      if (req.method === 'GET' && !API_PREFIXES.some((p) => path.startsWith(p))) return reply.sendFile('index.html');
      return reply.code(404).send({ message: '未找到' });
    });
  }
  return app;
}
