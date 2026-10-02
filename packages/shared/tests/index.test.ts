import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/index';

describe('shared 包', () => {
  it('导出协议版本号', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
