// 用启动时打印的访问令牌换取会话 Cookie
import type { FastifyInstance } from 'fastify';
import { safeEqual, SESSION_COOKIE } from './security';

export function registerAuthRoute(app: FastifyInstance, token: string): void {
  app.get<{ Querystring: { token?: string } }>('/auth', async (req, reply) => {
    const given = req.query.token ?? '';
    if (!safeEqual(given, token)) return reply.code(401).send({ message: '访问令牌不正确' });
    // 只在本机 HTTP 下使用，不加 Secure；会话 Cookie，关闭浏览器即失效
    reply.header('set-cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`);
    return reply.redirect('/', 302);
  });
}
