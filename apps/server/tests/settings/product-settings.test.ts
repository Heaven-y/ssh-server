import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { ProductSettingsSchema, type ProductSettingsInput } from '@ssh-server/shared';
import { createProductSettings } from '../../src/settings/product-settings';
import { registerProductSettingsRoutes } from '../../src/http/product-settings.routes';
import { createEnvironmentService } from '../../src/settings/environment';

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
    defaultModels: { claude: '', codex: 'example' },
  };
  const saved = await f.store.save({ settings: first, revision: defaults.revision });
  expect(saved.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(await createProductSettings({ configDir: f.configDir }).read()).toEqual(saved);
  const result = await Promise.allSettled(
    [5, 6].map((syncIntervalSeconds) =>
      f.store.save({ revision: saved.revision, settings: { ...first, syncIntervalSeconds } }),
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
    { ...ProductSettingsSchema.parse({}), syncIntervalSeconds: 4 },
    { ...ProductSettingsSchema.parse({}), resources: { intervalSeconds: 2, timeoutSeconds: 31 } },
  ])
    await expect(f.store.save({ settings, revision: 'missing' })).rejects.toMatchObject({
      status: 400,
    });
  expect(await readdir(f.configDir)).toEqual([]);
});

it('生产HTTP严格校验、摘要冲突与no-store贯通真实存储', async () => {
  const f = await fixture();
  const app = Fastify();
  registerProductSettingsRoutes(app, f.store, createEnvironmentService());
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
    await writeFile(f.file, JSON.stringify({ ...input.settings, syncIntervalSeconds: 20 }));
    const conflict = await app.inject({ method: 'PUT', url: '/api/settings/product', payload: save.json() });
    expect(conflict.statusCode).toBe(409);
    expect((await f.store.read()).settings.syncIntervalSeconds).toBe(20);
  } finally {
    await app.close();
  }
});
