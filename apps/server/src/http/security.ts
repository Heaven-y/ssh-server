// 访问控制：Host 校验（防 DNS 重绑定）、Origin 校验（防跨站请求）、会话 Cookie
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export const SESSION_COOKIE = 'ssh_server_session';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export type SecurityOptions = {
  token: string;
  /** 配置的端口；真实监听后以实际端口为准（端口 0 时尤其重要） */
  port: number;
  /** 开发时 Vite 的来源 */
  devOrigin?: string;
};

/** 常量时间比较，避免通过响应时间猜测令牌 */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function hostnameOf(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) return undefined;
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return undefined;
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx !== -1 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

const pathOf = (req: FastifyRequest) => req.url.split('?', 1)[0]!;

export function registerSecurity(app: FastifyInstance, opts: SecurityOptions): void {
  const devHostname = opts.devOrigin ? new URL(opts.devOrigin).hostname : undefined;

  const allowedOrigins = (): Set<string> => {
    const addr = app.server.address();
    const port = addr && typeof addr === 'object' ? addr.port : opts.port;
    const set = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]);
    if (opts.devOrigin) set.add(opts.devOrigin);
    return set;
  };

  app.addHook('onRequest', async (req, reply) => {
    // 1. Host 必须是本机地址：挡住 DNS 重绑定
    const hostname = hostnameOf(req.headers.host);
    if (!hostname || !(LOOPBACK_HOSTNAMES.has(hostname) || hostname === devHostname)) {
      return reply.code(403).send({ message: '拒绝访问：Host 不是本机地址' });
    }

    const path = pathOf(req);
    const isInternal = path.startsWith('/internal/');
    const isUpgrade = req.headers.upgrade?.toLowerCase() === 'websocket';

    // 2. 修改类请求与 WebSocket 必须来自本工具的页面：挡住其他网页借浏览器发请求
    //    /internal 只给本机的 MCP 子进程调用，不带 Origin，由路由自己校验会话令牌
    if (!isInternal && (isUpgrade || (req.method !== 'GET' && req.method !== 'HEAD'))) {
      const origin = req.headers.origin;
      if (!origin || !allowedOrigins().has(origin)) {
        return reply.code(403).send({ message: '拒绝访问：请求来源不被允许' });
      }
    }

    // 3. /api 与 /ws 需要登录 Cookie
    if (path.startsWith('/api/') || path === '/ws') {
      const value = readCookie(req.headers.cookie, SESSION_COOKIE);
      if (!value || !safeEqual(value, opts.token)) {
        return reply.code(401).send({ message: '未登录：请使用启动时打印的访问地址打开页面' });
      }
    }
    return undefined;
  });
}
