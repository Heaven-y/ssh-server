import { expect, it } from 'vitest';
import { ProductSettingsSchema } from '../src/settings/product-settings';

it('光影默认开启，公开设置只保留开关', () => {
  const settings = ProductSettingsSchema.parse({});
  expect(settings.spotlight).toEqual({ enabled: true });
  for (const patch of [{ intensity: 80 }, { size: 0 }, { softness: -1 }, { color: 'url(example)' }]) {
    expect(ProductSettingsSchema.safeParse({ spotlight: { ...settings.spotlight, ...patch } }).success).toBe(false);
  }
});
