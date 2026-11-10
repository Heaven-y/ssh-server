import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { ProductSettingsSchema, type ProductSettingsInput } from '@agentdeck/shared/settings';
import { createProductSettings } from '../../src/settings/product-settings';
import { registerProductSettingsRoutes } from '../../src/http/product-settings.routes';
import { createAgentProbes } from '../../src/agents/common/probe';
import { ProcessError } from '../../src/platform/process/run';

// 这些用例只关心产品设置存储与校验，环境接口固定按「未找到」返回。
const probes = () =>
  createAgentProbes({ run: () => Promise.reject(new ProcessError('executable_missing', '测试不探测本机 CLI')) });

const roots: string[] = [];
async function fixture() {
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'product-settings-'));
  roots.push(configDir);
  return {
    configDir,
    store: createProductSettings({ configDir }),
    file: path.join(configDir, 'product-settings.json'),
  };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('缺失只读默认，保存后重启读取；同摘要并发保存仅一个成功', async () => {
  const f = await fixture();
  const defaults = await f.store.read();
  expect(defaults).toEqual({ settings: ProductSettingsSchema.parse({}), revision: 'missing' });
  expect(await readdir(f.configDir)).toEqual([]);
  const first = {
    ...defaults.settings,
    defaultAgent: 'codex' as const,
  };
  const saved = await f.store.save({ settings: first, revision: defaults.revision });
  expect(saved.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(await createProductSettings({ configDir: f.configDir }).read()).toEqual(saved);
  const result = await Promise.allSettled(
    [6, 7].map((intervalSeconds) =>
      f.store.save({
        revision: saved.revision,
        settings: { ...first, resources: { intervalSeconds, timeoutSeconds: 8 } },
      }),
    ),
  );
  expect(result.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
  const failed = result.find((entry) => entry.status === 'rejected');
  expect(failed).toMatchObject({ reason: { status: 409, code: 'revision_conflict' } });
  expect(await readdir(f.configDir)).toEqual(['product-settings.json']);
});

it('坏文件、非法字段和超界拒绝，不重建或覆盖原文', async () => {
  const f = await fixture();
  await writeFile(f.file, '{bad json');
  await expect(f.store.read()).rejects.toMatchObject({ status: 503, code: 'settings_invalid' });
  await expect(f.store.save({ settings: ProductSettingsSchema.parse({}), revision: 'missing' })).rejects.toMatchObject({
    status: 503,
  });
  expect(await readFile(f.file, 'utf8')).toBe('{bad json');
  await rm(f.file);
  for (const settings of [
    { ...ProductSettingsSchema.parse({}), secret: 'unknown' },
    { ...ProductSettingsSchema.parse({}), resources: { intervalSeconds: 1, timeoutSeconds: 8 } },
    { ...ProductSettingsSchema.parse({}), resources: { intervalSeconds: 2, timeoutSeconds: 31 } },
  ])
    await expect(f.store.save({ settings, revision: 'missing' })).rejects.toMatchObject({
      status: 400,
    });
  expect(await readdir(f.configDir)).toEqual([]);
});

it('模型显示范围按 CLI 持久保存，空列表与未配置分别保留', async () => {
  const f = await fixture();
  const initial = await f.store.read();
  const settings = { ...initial.settings, modelVisibility: { claude: ['sonnet'], codex: [] } };
  await f.store.save({ settings, revision: initial.revision });
  const restarted = await createProductSettings({ configDir: f.configDir }).read();
  expect(restarted.settings).toEqual(settings);
  expect(restarted.settings.modelVisibility?.antigravity).toBeUndefined();
});

it('生产HTTP严格校验、摘要冲突与no-store贯通真实存储', async () => {
  const f = await fixture();
  const app = Fastify();
  registerProductSettingsRoutes(app, f.store, probes());
  try {
    const read = await app.inject({ url: '/api/settings/product' });
    expect(read.statusCode).toBe(200);
    expect(read.headers['cache-control']).toBe('no-store');
    const input = read.json<ProductSettingsInput>();
    const save = await app.inject({ method: 'PUT', url: '/api/settings/product', payload: input });
    expect(save.statusCode).toBe(200);
    expect(save.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'PUT', url: '/api/settings/product', payload: input })).statusCode).toBe(409);
    expect((await app.inject({ url: '/api/settings/product?path=other' })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'PUT', url: '/api/settings/product', payload: { ...input, unknown: true } }))
        .statusCode,
    ).toBe(400);
    await writeFile(
      f.file,
      JSON.stringify({ ...input.settings, resources: { intervalSeconds: 20, timeoutSeconds: 8 } }),
    );
    const conflict = await app.inject({ method: 'PUT', url: '/api/settings/product', payload: save.json() });
    expect(conflict.statusCode).toBe(409);
    expect((await f.store.read()).settings.resources.intervalSeconds).toBe(20);
  } finally {
    await app.close();
  }
});

it('服务器资源采样缺省5秒，显式间隔不被迁移，修改15秒只改变指定偏好', async () => {
  const f = await fixture();
  const defaults = await f.store.read();
  expect(defaults.settings.resources.intervalSeconds).toBe(5);
  expect(
    ProductSettingsSchema.parse({ resources: { intervalSeconds: 15, timeoutSeconds: 8 } }).resources.intervalSeconds,
  ).toBe(15);
  const custom = {
    ...defaults.settings,
    defaultAgent: 'codex' as const,
    resources: { intervalSeconds: 15, timeoutSeconds: 9 },
  };
  const previous = await f.store.save({ settings: custom, revision: defaults.revision });
  expect((await createProductSettings({ configDir: f.configDir }).read()).settings.resources.intervalSeconds).toBe(15);
  const updated = await f.store.save({
    revision: previous.revision,
    settings: { ...previous.settings, resources: { intervalSeconds: 30, timeoutSeconds: 9 } },
  });
  expect(updated.settings).toEqual({ ...custom, resources: { intervalSeconds: 30, timeoutSeconds: 9 } });
  expect(updated.revision).not.toBe(previous.revision);
});

it('光影开关写入磁盘，旧效果参数退休且保留关闭状态', async () => {
  const f = await fixture();
  const old = { spotlight: { enabled: false, color: '#7755aa', intensity: 20, size: 440, softness: 90 } };
  await writeFile(f.file, JSON.stringify(old));
  const before = await f.store.read();
  expect(before.settings.spotlight).toEqual({ enabled: false });
  expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual(old);
  const spotlight = { enabled: false };
  await f.store.save({ revision: before.revision, settings: { ...before.settings, spotlight } });
  const reopened = await createProductSettings({ configDir: f.configDir }).read();
  expect(reopened.settings.spotlight).toEqual(spotlight);
  expect(JSON.parse(await readFile(f.file, 'utf8')).spotlight).toEqual(spotlight);
  expect(reopened.settings.resources).toEqual(before.settings.resources);
});

it('磁盘只退休已删除的字段，保留有效偏好和原文摘要，显式保存才更新文件', async () => {
  const f = await fixture();
  const preferences = {
    defaultAgent: 'codex' as const,
    resources: { intervalSeconds: 7, timeoutSeconds: 9 },
  };
  const original = JSON.stringify({
    ...preferences,
    defaultModels: { claude: 'retired-claude', codex: 'retired-codex' },
    syncDefaults: { maxFileBytes: 8388608, excludedExtensions: ['pt'] },
    syncIntervalSeconds: 15,
  });
  await writeFile(f.file, original, 'utf8');
  const loaded = await f.store.read();
  expect(loaded.settings).toEqual(ProductSettingsSchema.parse(preferences));
  expect(loaded.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(await readFile(f.file, 'utf8')).toBe(original);
  const saved = await f.store.save({
    revision: loaded.revision,
    settings: { ...loaded.settings, resources: { intervalSeconds: 20, timeoutSeconds: 9 } },
  });
  expect(saved.settings).toEqual({ ...loaded.settings, resources: { intervalSeconds: 20, timeoutSeconds: 9 } });
  expect(JSON.parse(await readFile(f.file, 'utf8'))).toEqual({
    ...loaded.settings,
    resources: { intervalSeconds: 20, timeoutSeconds: 9 },
  });
  await expect(f.store.save(loaded)).rejects.toMatchObject({ status: 409, code: 'revision_conflict' });
});

it.each([
  { unknown: true },
  { resources: { intervalSeconds: 1, timeoutSeconds: 8 } },
  // 退休字段被剔除后，其余活动字段仍按原规则校验，不回退默认值。
  { resources: { intervalSeconds: 2, timeoutSeconds: 31 }, syncIntervalSeconds: 15 },
])('退休磁盘字段不放宽其余校验或回退默认：%j', async (invalid) => {
  const f = await fixture();
  const original = JSON.stringify({
    defaultAgent: 'codex',
    defaultModels: { claude: 'retired', codex: '' },
    ...invalid,
  });
  await writeFile(f.file, original, 'utf8');
  await expect(f.store.read()).rejects.toMatchObject({ status: 503, code: 'settings_invalid' });
  expect(await readFile(f.file, 'utf8')).toBe(original);
});

it('公开HTTP拒绝退休字段，不把磁盘读取边界当作API兼容层', async () => {
  const f = await fixture();
  const app = Fastify();
  registerProductSettingsRoutes(app, f.store, probes());
  try {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/product',
      payload: {
        revision: 'missing',
        settings: { defaultAgent: 'codex', syncIntervalSeconds: 15 },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'invalid_request' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await readdir(f.configDir)).toEqual([]);
  } finally {
    await app.close();
  }
});
