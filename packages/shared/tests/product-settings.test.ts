import { expect, it } from 'vitest';
import { ProductSettingsInputSchema, ProductSettingsSchema } from '../src/product-settings';

it('产品设置仅保存默认Agent与服务器资源采样偏好', () => {
  const settings = ProductSettingsSchema.parse({
    defaultAgent: 'codex',
    resources: { intervalSeconds: 7, timeoutSeconds: 9 },
  });
  expect(settings).toEqual({
    defaultAgent: 'codex',
    resources: { intervalSeconds: 7, timeoutSeconds: 9 },
  });
});

it('同步域删除后，公开输入不再接受旧的同步偏好', () => {
  for (const retired of [{ syncDefaults: { maxFileBytes: 8388608 } }, { syncIntervalSeconds: 15 }]) {
    expect(ProductSettingsSchema.safeParse(retired).success).toBe(false);
    expect(ProductSettingsInputSchema.safeParse({ settings: retired, revision: 'missing' }).success).toBe(false);
  }
  expect(ProductSettingsSchema.parse({})).not.toHaveProperty('syncDefaults');
});

it.each([
  { claude: '', codex: '' },
  { claude: 'retired-model', codex: 'old-model' },
])('公开产品设置输入拒绝已退休的defaultModels：%j', (defaultModels) => {
  const settings = { defaultAgent: 'codex', defaultModels };
  expect(ProductSettingsSchema.safeParse(settings).success).toBe(false);
  expect(ProductSettingsInputSchema.safeParse({ settings, revision: 'missing' }).success).toBe(false);
});
