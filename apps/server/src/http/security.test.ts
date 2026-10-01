import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { readCookie, registerSecurity, safeEqual, SESSION_COOKIE } from './security';

const TOKEN = 'tok';
const DEV = 'http://127.0.0.1:5173';

/** 未监听端口的应用：允许的来源按配置端口计算 */
function make(devOrigin?: string) {
  const app = Fastify();
  registerSecurity(app, { token: TOKEN, port: 4317, devOrigin });
  app.get('/api/x', async () => ({ ok: true }));
  app.post('/api/x', async () => ({ ok: true }));
  return app;
}

const cookie = `${SESSION_COOKIE}=${TOKEN}`;

describe('访问控制边界', () => {
  it('无法解析的 Host 时 403', async () => {
    const app = make();
    // inject 会把空 Host 换成 localhost:80，因此只测无法被 URL 解析的值
    for (const host of ['a b:1', '[::1:4317']) {
      const r = await app.inject({ method: 'GET', url: '/api/x', headers: { host, cookie } });
      expect(r.statusCode).toBe(403);
    }
  });

  it('localhost 与 [::1] 视为本机', async () => {
    const app = make();
    for (const host of ['localhost:4317', '[::1]:4317']) {
      const r = await app.inject({ method: 'GET', url: '/api/x', headers: { host, cookie } });
      expect(r.statusCode).toBe(200);
    }
  });

  it('未监听时按配置端口校验 Origin；配置了开发来源时也允许它', async () => {
    const plain = make();
    const viaDev = { host: '127.0.0.1:5173', origin: DEV, cookie };
    expect((await plain.inject({ method: 'POST', url: '/api/x', headers: viaDev })).statusCode).toBe(403);
    const ok = { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', cookie };
    expect((await plain.inject({ method: 'POST', url: '/api/x', headers: ok })).statusCode).toBe(200);

    const dev = make(DEV);
    expect((await dev.inject({ method: 'POST', url: '/api/x', headers: viaDev })).statusCode).toBe(200);
  });

  it('Cookie 值错误时 401（含长度不同）', async () => {
    const app = make();
    for (const v of ['tok2', 'to', '']) {
      const headers = { host: '127.0.0.1:4317', cookie: `${SESSION_COOKIE}=${v}` };
      expect((await app.inject({ method: 'GET', url: '/api/x', headers })).statusCode).toBe(401);
    }
  });
});

describe('辅助函数', () => {
  it('safeEqual 长度不同直接返回 false', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('readCookie 处理多个 Cookie 与缺失', () => {
    expect(readCookie('a=1; b=2', 'b')).toBe('2');
    expect(readCookie('a=1', 'b')).toBeUndefined();
    expect(readCookie(undefined, 'b')).toBeUndefined();
  });
});
