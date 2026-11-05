// 组装 Fastify 应用：WebSocket 插件、访问控制、本机会话、静态页面。
// 业务路由（项目、会话、服务器）由 main.ts 通过 routes 注入，这里不再认识项目存储。
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuthRoute } from './auth';
import { registerSecurity } from './security';

export type AppDeps = {
  token: string;
  port: number;
  devOrigin?: string;
  /** 前端构建产物目录，存在时托管静态文件 */
  webDir?: string;
  /** 注册其余路由（项目、会话、服务器接口与 /ws） */
  routes?: (app: FastifyInstance) => void | Promise<void>;
};

/** 后端接口前缀：这些路径不回退到前端页面，未匹配时保持 404 */
const API_PREFIXES = ['/api/', '/internal', '/ws', '/auth'];

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  try {
    await app.register(fastifyWebsocket, { options: { maxPayload: 1024 * 1024 } });

    registerSecurity(app, { token: deps.token, port: deps.port, devOrigin: deps.devOrigin });
    registerAuthRoute(app, deps.token);
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
  } catch (error) {
    // 构造阶段还没有把实例交给调用方；必须在这里触发已注册资源的关闭钩子。
    await app.close().catch(() => undefined);
    throw error;
  }
}
