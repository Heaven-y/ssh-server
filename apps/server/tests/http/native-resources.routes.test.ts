import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { NativeResourceCatalog, NativeResourceDocument } from '@agentdeck/shared/settings';
import { registerNativeResourceRoutes } from '../../src/http/native-resources.routes';
import { createNativeResourcesService } from '../../src/settings/native-resources';

const fixtures: { root: string; app: FastifyInstance }[] = [];
async function setup() {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-resource-api-'));
  const project = { id: 'demo', name: '示例项目', dir: path.join(homeDir, 'project') };
  await fs.mkdir(project.dir);
  const app = Fastify();
  fixtures.push({ root: homeDir, app });
  registerNativeResourceRoutes(app, {
    service: createNativeResourcesService({ homeDir, env: {} }),
    store: { get: async (id) => (id === project.id ? project : undefined) },
  });
  return { app, homeDir, project };
}
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.app.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

describe('原生资源 HTTP 接口', () => {
  it('普通目录不带正文，显式打开返回正文，保存只返回修订且全程禁止缓存', async () => {
    const { app, homeDir } = await setup();
    const directory = path.join(homeDir, '.claude');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'settings.json'), '{"secret":"sentinel-private"}');
    const listing = await app.inject({ method: 'GET', url: '/api/native-resources/claude' });
    expect(listing.statusCode).toBe(200);
    expect(listing.body).not.toContain('sentinel-private');
    const catalog = listing.json<NativeResourceCatalog>();
    const target = catalog.entries.find((entry) => entry.kind === 'settings')!;
    const base = `/api/native-resources/claude/${target.id}`;
    expect((await app.inject({ method: 'GET', url: base })).statusCode).toBe(404);
    const opened = await app.inject({ method: 'POST', url: `${base}/open`, payload: {} });
    expect(opened.statusCode).toBe(200);
    const document = opened.json<NativeResourceDocument>();
    expect(document.content).toContain('sentinel-private');
    const saved = await app.inject({
      method: 'PUT',
      url: base,
      payload: { content: '{"secret":"replacement-private"}', revision: document.revision },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain('replacement-private');
    expect(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).toBe('{"secret":"replacement-private"}');
    for (const response of [listing, opened, saved]) expect(response.headers['cache-control']).toBe('no-store');
  });

  it('projectId 只能由项目存储解析，固定 root 创建成功后可再次打开', async () => {
    const { app, project } = await setup();
    const base = '/api/native-resources/codex';
    const listing = await app.inject({ method: 'GET', url: `${base}?projectId=${project.id}` });
    const catalog = listing.json<NativeResourceCatalog>();
    const root = catalog.roots.find((entry) => entry.kind === 'skills' && entry.scope === 'project')!;
    const created = await app.inject({
      method: 'POST',
      url: `${base}?projectId=${project.id}`,
      payload: { rootId: root.id, name: 'demo-skill', content: '# 示例\n' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain('# 示例');
    const id = created.json<{ resource: { id: string } }>().resource.id;
    const opened = await app.inject({ method: 'POST', url: `${base}/${id}/open?projectId=${project.id}` });
    expect(opened.statusCode).toBe(200);
    expect(opened.json<NativeResourceDocument>().content).toBe('# 示例\n');
    expect((await app.inject({ method: 'POST', url: `${base}/${id}/open` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${base}?projectId=unknown` })).json()).toMatchObject({
      code: 'project_missing',
    });
  });

  it('拒绝路径注入、额外参数和无效修订，解析错误不回显秘密', async () => {
    const { app } = await setup();
    const id = 'a'.repeat(64);
    const requests = [
      { method: 'GET' as const, url: '/api/native-resources/unknown' },
      { method: 'GET' as const, url: '/api/native-resources/codex?path=outside' },
      { method: 'POST' as const, url: `/api/native-resources/codex/${id}/open`, payload: { path: 'outside' } },
      {
        method: 'PUT' as const,
        url: `/api/native-resources/codex/${id}`,
        payload: { content: '', revision: 'not-a-revision' },
      },
      {
        method: 'POST' as const,
        url: '/api/native-resources/codex',
        payload: { rootId: id, name: 'demo', content: '', path: 'outside' },
      },
      {
        method: 'PUT' as const,
        url: `/api/native-resources/codex/${id}`,
        headers: { 'content-type': 'application/json' },
        payload: '{"sentinel-private": broken}',
      },
    ];
    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(400);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toContain('sentinel-private');
    }
  });
});
