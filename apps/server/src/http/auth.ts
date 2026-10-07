// 经同源校验的本机页面自动建立会话，秘密不进入URL或JavaScript。
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE } from './security';

const Empty = z.strictObject({});
export function registerAuthRoute(app: FastifyInstance, token: string): void {
  app.post('/api/local-session', { bodyLimit: 1024 }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!Empty.safeParse(req.body).success || !Empty.safeParse(req.query).success)
      return reply.code(400).send({ message: '本机会话请求格式不正确' });
    // 只在本机HTTP下使用，不加Secure；HttpOnly会话Cookie不暴露给前端脚本。
    reply.header('set-cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`);
    return reply.code(204).send();
  });
}
