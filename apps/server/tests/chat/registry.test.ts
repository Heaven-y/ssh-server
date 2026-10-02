import { describe, expect, it } from 'vitest';
import { createSessionRegistry } from '../../src/chat/registry';

describe('createSessionRegistry', () => {
  it('登记后可用令牌找到工作区，注销后失效', () => {
    const reg = createSessionRegistry();
    const t1 = reg.register('w1');
    const t2 = reg.register('w1');
    expect(t1).not.toBe(t2);
    expect(t1.length).toBeGreaterThanOrEqual(43);
    expect(reg.resolve(t1)).toBe('w1');
    reg.unregister(t1);
    expect(reg.resolve(t1)).toBeUndefined();
    expect(reg.resolve(t2)).toBe('w1');
  });

  it('未知令牌返回 undefined', () => {
    expect(createSessionRegistry().resolve('nope')).toBeUndefined();
  });
});
