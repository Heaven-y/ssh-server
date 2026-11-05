import path from 'node:path';
import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { createCapabilitiesService } from '../../src/chat/capabilities';
import { registerModelCatalogRoutes } from '../../src/http/model-catalog.routes';

it('设置模型目录GET只读缓存，显式获取使用可信项目目录并与对话共用结果', async () => {
  const app = Fastify();
  const directory = path.resolve('fixtures', 'project');
  const provider = vi.fn(async () => ({ models: [{ id: 'custom', label: '自定义' }], entries: [], warnings: [] }));
  const capabilities = createCapabilitiesService({ codex: provider });
  registerModelCatalogRoutes(app, {
    capabilities,
    store: { get: async (id) => (id === 'project' ? { id, name: '示例', dir: directory } : undefined) },
  });
  try {
    const url = '/api/settings/models/codex/catalog?projectId=project';
    const initial = await app.inject({ url });
    expect(initial.json().discovered).toBe(false);
    expect(provider).not.toHaveBeenCalled();
    const loaded = await app.inject({ method: 'POST', url });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().models).toEqual([{ id: 'custom', label: '自定义' }]);
    expect(provider).toHaveBeenCalledWith(directory, expect.any(AbortSignal));
    expect((await capabilities.read({ id: 'other-id', name: '同目录', dir: directory }, 'codex')).models).toEqual(
      loaded.json().models,
    );
    expect((await app.inject({ url })).json().models).toEqual(loaded.json().models);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(
      (await app.inject({ method: 'POST', url: '/api/settings/models/codex/catalog?path=elsewhere' })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: '/api/settings/models/codex/catalog?projectId=missing' })).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});
