import { expect, it } from 'vitest';
import { ProductSettingsInputSchema, ProductSettingsSchema } from '../src/product-settings';

it('产品设置仅保存默认Agent和产品偏好，不生成模型覆盖', () => {
  const settings = ProductSettingsSchema.parse({
    defaultAgent: 'codex',
    syncDefaults: { maxFileBytes: 8388608, excludedExtensions: ['pt'] },
    syncIntervalSeconds: 15,
    resources: { intervalSeconds: 7, timeoutSeconds: 9 },
  });
  expect(settings).toEqual({
    defaultAgent: 'codex',
    syncDefaults: { maxFileBytes: 8388608, excludedExtensions: ['pt'] },
    syncIntervalSeconds: 15,
    resources: { intervalSeconds: 7, timeoutSeconds: 9 },
  });
});

it.each([
  { claude: '', codex: '' },
  { claude: 'retired-model', codex: 'old-model' },
])('公开产品设置输入拒绝已退休的defaultModels：%j', (defaultModels) => {
  const settings = { defaultAgent: 'codex', defaultModels };
  expect(ProductSettingsSchema.safeParse(settings).success).toBe(false);
  expect(ProductSettingsInputSchema.safeParse({ settings, revision: 'missing' }).success).toBe(false);
});
