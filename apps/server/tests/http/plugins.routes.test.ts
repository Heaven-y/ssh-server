import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkbenchPluginCatalog, WorkbenchPluginStorage } from '@agentdeck/shared';
import { registerPluginRoutes } from '../../src/http/plugins.routes';
import { registerSecurity } from '../../src/http/security';
import { createWorkbenchPlugins } from '../../src/plugins/service';

const fixtures: { root: string; app: FastifyInstance }[] = [];
const headers = { host: '127.0.0.1:24455', origin: 'http://127.0.0.1:24455', cookie: 'AGENTDECK_session=test-token' };
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-api-'));
  const directory = path.join(root, 'package');
  await fs.mkdir(directory);
  await fs.writeFile(
    path.join(directory, 'agentdeck.plugin.json'),
    JSON.stringify({
      id: 'demo',
      name: '示例',
      version: '1.0.0',
      apiVersion: 1,
      entry: 'index.html',
      permissions: ['storage'],
    }),
  );
  await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><p>静态插件</p>');
  const app = Fastify();
  fixtures.push({ root, app });
  registerSecurity(app, { token: 'test-token', port: 24455 });
  registerPluginRoutes(app, { service: createWorkbenchPlugins({ configDir: path.join(root, 'config') }) });
  return { app, directory };
}
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.app.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

describe('工作台插件 HTTP 接口', () => {
  it('安装、启用、页面与存储走鉴权 JSON 接口，保持主应用帧限制', async () => {
    const { app, directory } = await setup();
    const installed = await app.inject({
      method: 'POST',
      url: '/api/plugins/install',
      headers,
      payload: { directory },
    });
    expect(installed.statusCode).toBe(201);
    const revision = installed.json<WorkbenchPluginCatalog>().revision;
    const enabled = await app.inject({
      method: 'PUT',
      url: '/api/plugins/demo',
      headers,
      payload: { enabled: true, revision },
    });
    expect(enabled.statusCode).toBe(200);
    const page = await app.inject({ method: 'GET', url: '/api/plugins/demo/page', headers });
    expect(page.json()).toEqual({ html: '<!doctype html><p>静态插件</p>' });
    expect(page.headers['content-type']).toContain('application/json');
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.headers['content-security-policy']).toBe("frame-ancestors 'none'; frame-src 'self'");
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/plugins/demo/storage',
      headers,
      payload: { value: { count: 2 }, revision: 'missing' },
    });
    expect(saved.statusCode).toBe(200);
    const read = await app.inject({ method: 'GET', url: '/api/plugins/demo/storage', headers });
    expect(read.json<WorkbenchPluginStorage>().value).toEqual({ count: 2 });
    for (const response of [installed, enabled, page, saved, read])
      expect(response.headers['cache-control']).toBe('no-store');
    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/plugins/demo',
      headers,
      payload: { revision: enabled.json<WorkbenchPluginCatalog>().revision },
    });
    expect(removed.json<WorkbenchPluginCatalog>().plugins).toHaveLength(1);
  });

  it('沙箱来源、匿名请求及任意资源路径不能绕过主接口检查', async () => {
    const { app } = await setup();
    const anonymous = await app.inject({ method: 'GET', url: '/api/plugins', headers: { host: headers.host } });
    expect(anonymous.statusCode).toBe(401);
    const opaque = await app.inject({
      method: 'PUT',
      url: '/api/plugins/demo/storage',
      headers: { ...headers, origin: 'null' },
      payload: { value: {}, revision: 'missing' },
    });
    expect(opaque.statusCode).toBe(403);
    const crossSite = await app.inject({
      method: 'GET',
      url: '/api/plugins/demo/page',
      headers: { ...headers, 'sec-fetch-site': 'cross-site' },
    });
    expect(crossSite.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/plugins/demo/assets/index.html', headers })).statusCode).toBe(
      404,
    );
  });

  it('固定请求字段与匿名错误覆盖解析失败，状态冲突保留409', async () => {
    const { app, directory } = await setup();
    const installed = await app.inject({
      method: 'POST',
      url: '/api/plugins/install',
      headers,
      payload: { directory },
    });
    const conflict = await app.inject({
      method: 'PUT',
      url: '/api/plugins/demo',
      headers,
      payload: { enabled: true, revision: 'missing' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(installed.statusCode).toBe(201);
    const invalid = [
      { method: 'GET' as const, url: '/api/plugins?path=outside' },
      {
        method: 'PUT' as const,
        url: '/api/plugins/demo',
        payload: { enabled: true, revision: 'missing', path: 'outside' },
      },
      { method: 'DELETE' as const, url: '/api/plugins/demo', payload: { revision: 'invalid' } },
      { method: 'PUT' as const, url: '/api/plugins/demo/storage', payload: { value: [], revision: 'missing' } },
      {
        method: 'POST' as const,
        url: '/api/plugins/install',
        payload: '{"private-secret": malformed}',
        headers: { ...headers, 'content-type': 'application/json' },
      },
    ];
    for (const request of invalid) {
      const response = await app.inject({ headers, ...request });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('private-secret');
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });
});
