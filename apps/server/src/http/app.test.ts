import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { Workspace, WorkspaceInput } from '@ssh-server/shared';
import type { WorkspaceStore } from '../workspaces/store';
import { buildApp } from './app';
import { SESSION_COOKIE } from './security';

const TOKEN = 'test-token-0123456789';
const HOST = '127.0.0.1:4317';
const ORIGIN = 'http://127.0.0.1:4317';
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

function memoryStore(): WorkspaceStore {
  const items: Workspace[] = [];
  return {
    list: async () => items,
    get: async (id) => items.find((w) => w.id === id),
    create: async (input: WorkspaceInput) => {
      const ws = { ...input, id: `w${items.length + 1}` };
      items.push(ws);
      return ws;
    },
    update: async () => undefined,
    remove: async () => false,
  };
}

const apps: FastifyInstance[] = [];
async function make(): Promise<FastifyInstance> {
  const app = await buildApp({
    token: TOKEN,
    port: 4317,
    store: memoryStore(),
    listSshHosts: async () => [],
    routes: (a) => {
      // 测试用的内部接口：自行要求 Bearer
      a.get('/internal/ping', async (req, reply) =>
        req.headers.authorization === 'Bearer internal' ? { ok: true } : reply.code(401).send({ message: '未授权' }),
      );
      a.get('/ws', { websocket: true }, (socket) => socket.send('hello'));
    },
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

const body: WorkspaceInput = { name: 'demo', localDir: 'D:/w', sshHost: 'my-server', remoteDir: '~/projects/demo' };

describe('访问控制', () => {
  it('Host 不是本机地址时 403', async () => {
    const app = await make();
    const r = await app.inject({
      method: 'GET',
      url: '/api/workspaces',
      headers: { host: 'evil.com', cookie: COOKIE },
    });
    expect(r.statusCode).toBe(403);
  });

  it('没有 Cookie 访问 /api 返回 401', async () => {
    const app = await make();
    const r = await app.inject({ method: 'GET', url: '/api/workspaces', headers: { host: HOST } });
    expect(r.statusCode).toBe(401);
  });

  it('令牌正确时设置 Cookie 并跳转', async () => {
    const app = await make();
    const r = await app.inject({ method: 'GET', url: `/auth?token=${TOKEN}`, headers: { host: HOST } });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/');
    const setCookie = String(r.headers['set-cookie']);
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
  });

  it('令牌错误时 401', async () => {
    const app = await make();
    const r = await app.inject({ method: 'GET', url: '/auth?token=wrong', headers: { host: HOST } });
    expect(r.statusCode).toBe(401);
  });

  it('带 Cookie 的 GET 可以访问 /api', async () => {
    const app = await make();
    const r = await app.inject({ method: 'GET', url: '/api/workspaces', headers: { host: HOST, cookie: COOKIE } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]);
  });

  it('修改类请求：Origin 不对或缺失时 403，正确时成功', async () => {
    const app = await make();
    const post = (origin?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/workspaces',
        headers: { host: HOST, cookie: COOKIE, ...(origin ? { origin } : {}) },
        payload: body,
      });
    expect((await post('http://evil.com')).statusCode).toBe(403);
    expect((await post()).statusCode).toBe(403);
    expect((await post('http://127.0.0.1:9999')).statusCode).toBe(403);
    expect((await post(ORIGIN)).statusCode).toBe(201);
  });

  it('/internal 不认 Cookie', async () => {
    const app = await make();
    const r = await app.inject({ method: 'GET', url: '/internal/ping', headers: { host: HOST, cookie: COOKIE } });
    expect(r.statusCode).toBe(401);
    const ok = await app.inject({
      method: 'GET',
      url: '/internal/ping',
      headers: { host: HOST, authorization: 'Bearer internal' },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('WebSocket 来源校验（真实监听）', () => {
  function connect(port: number, origin: string, cookie?: string): Promise<boolean> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin, headers: cookie ? { cookie } : {} });
      ws.once('open', () => {
        ws.close();
        resolve(true);
      });
      ws.once('error', () => resolve(false));
    });
  }

  it('Origin 不对、没有 Cookie 时拒绝；正确时连接成功', async () => {
    const app = await make();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const port = (app.server.address() as { port: number }).port;
    expect(await connect(port, 'http://evil.com', COOKIE)).toBe(false);
    expect(await connect(port, `http://127.0.0.1:${port}`)).toBe(false);
    expect(await connect(port, `http://127.0.0.1:${port}`, COOKIE)).toBe(true);
  });
});
