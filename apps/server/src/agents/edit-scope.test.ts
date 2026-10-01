import { describe, expect, it } from 'vitest';
import { isInsideDir } from './edit-scope';

describe('isInsideDir（Windows 路径）', () => {
  const dir = 'E:\\w\\p';

  it('盘符大小写、斜杠方向不同也视为同一目录', () => {
    expect(isInsideDir(dir, 'e:/w/p/a.ts')).toBe(true);
  });

  it('相对路径按目录解析', () => {
    expect(isInsideDir(dir, 'src/a.ts')).toBe(true);
    expect(isInsideDir(dir, '..\\..\\x')).toBe(false);
  });

  it('前缀相同的兄弟目录不算在内', () => {
    expect(isInsideDir(dir, 'E:\\w\\p2\\a.ts')).toBe(false);
  });

  it('目录本身算在内；其他盘不算', () => {
    expect(isInsideDir(dir, 'E:\\w\\p')).toBe(true);
    expect(isInsideDir(dir, 'D:\\w\\p\\a.ts')).toBe(false);
  });
});
