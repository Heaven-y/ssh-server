import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { Workspace, WorkspaceInput } from '@agentdeck/shared';
import type { WorkspaceStore } from '../../src/workspaces/store';
import { buildApp } from '../../src/http/app';
import { registerProjectRoutes } from '../../src/http/projects.routes';
import { SESSION_COOKIE } from '../../src/http/security';

const TOKEN = 'test-token-0123456789';
const HOST = '127.0.0.1:4317';
const ORIGIN = 'http://127.0.0.1:4317';
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

function memoryStore(): WorkspaceStore {
  const items: Workspace[] = [];
  return {
    list: async () => items,
    withSnapshot: async (operation) => operation(items),
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
const webDirs: string[] = [];
async function make(): Promise<FastifyInstance> {
  const store = memoryStore();
  const app = await buildApp({
    token: TOKEN,
    port: 4317,
    routes: (a) => {
      registerProjectRoutes(a, { store });
      a.get('/ws', { websocket: true }, (socket) => socket.send('hello'));
    },
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  await Promise.all(webDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const body: WorkspaceInput = {
  name: 'demo',
  dir: path.join(os.tmpdir(), 'agentdeck-fixture', 'demo'),
  server: 'my-server',
  remoteDir: '~/projects/demo',
};

describe('访问控制', () => {
  it('Host 不是本机地址时 403', async () => {
    const app = await make();
    const r = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { host: 'evil.com', cookie: COOKIE },
    });
    expect(r.statusCode).toBe(403);
  });

  it('没有 Cookie 访问 /api 返回 401', async () => {
    const app = await make();
    const r = await app.inject({ method: 'GET', url: '/api/projects', headers: { host: HOST } });
    expect(r.statusCode).toBe(401);
  });

  it('同源空对象自动建立HttpOnly会话，不向正文或URL泄露秘密', async () => {
    const app = await make();
    const r = await app.inject({
      method: 'POST',
      url: '/api/local-session',
      headers: { host: HOST, origin: ORIGIN },
      payload: {},
    });
    expect(r.statusCode).toBe(204);
    expect(r.body).toBe('');
    expect(r.headers.location).toBeUndefined();
    const setCookie = String(r.headers['set-cookie']);
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(r.headers['cache-control']).toBe('no-store');
    const response = await app.inject({
      url: '/api/projects',
      headers: { host: HOST, cookie: setCookie.split(';')[0]! },
    });
    expect(response.statusCode).toBe(200);
  });

  it('握手拒绝不可信来源、异常Host和跨站Fetch Metadata', async () => {
    const app = await make();
    for (const headers of [
      { host: HOST },
      { host: HOST, origin: 'null' },
      { host: HOST, origin: 'http://evil.com' },
      { host: 'evil.com', origin: ORIGIN },
      { host: '127.0.0.1:9999', origin: ORIGIN },
      { host: 'evil@127.0.0.1:4317', origin: ORIGIN },
      { host: HOST, origin: ORIGIN, 'sec-fetch-site': 'cross-site' },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/local-session', headers, payload: {} });
      expect(response.statusCode).toBe(403);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });

  it('握手只接受空对象且旧auth入口不存在', async () => {
    const app = await make();
    for (const [url, payload] of [
      ['/api/local-session', { token: TOKEN }],
      ['/api/local-session?token=x', {}],
    ] as const) {
      const response = await app.inject({ method: 'POST', url, headers: { host: HOST, origin: ORIGIN }, payload });
      expect(response.statusCode).toBe(400);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    expect((await app.inject({ url: `/auth?token=${TOKEN}`, headers: { host: HOST } })).statusCode).toBe(404);
  });

  it('旧SSH主机列表入口不再提供，只维护统一服务器档案', async () => {
    const app = await make();
    const response = await app.inject({ url: '/api/ssh-hosts', headers: { host: HOST, cookie: COOKIE } });
    expect(response.statusCode).toBe(404);
  });

  it('页面和错误响应都禁止外部iframe嵌入', async () => {
    const app = await make();
    const response = await app.inject({ url: '/', headers: { host: HOST } });
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('带 Cookie 的 GET 可以访问 /api', async () => {
    const app = await make();
    const r = await app.inject({ method: 'GET', url: '/api/projects', headers: { host: HOST, cookie: COOKIE } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]);
  });

  it('修改类请求：Origin 不对或缺失时403，正确时进入业务路由', async () => {
    const app = await make();
    const post = (origin?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { host: HOST, cookie: COOKIE, ...(origin ? { origin } : {}) },
        payload: body,
      });
    expect((await post('http://evil.com')).statusCode).toBe(403);
    expect((await post()).statusCode).toBe(403);
    expect((await post('http://127.0.0.1:9999')).statusCode).toBe(403);
    // 项目创建接口已迁到 /api/projects，放行 Origin 后应进入业务路由而不是被安全钩子挡下。
    expect((await post(ORIGIN)).statusCode).toBe(200);
  });
  it('挂载前端产物后，/internal 路径仍是 404 而不回退到页面', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-web-'));
    webDirs.push(dir);
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>shell</title>', 'utf8');
    const app = await buildApp({ token: TOKEN, port: 4317, webDir: dir });
    apps.push(app);
    const header = { host: HOST, cookie: COOKIE };
    const internal = await app.inject({ url: '/internal/remote-exec', headers: header });
    expect(internal.statusCode).toBe(404);
    expect(internal.json()).toEqual({ message: '未找到' });
    // 普通页面路径仍回退到 index.html。
    const page = await app.inject({ url: '/projects/1', headers: header });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>shell</title>');
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
