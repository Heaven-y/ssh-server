import { describe, expect, it } from 'vitest';
import { SyncSettingsSchema } from '@ssh-server/shared';
import { eligibleFile, filterText, safeRelativePath } from './filters';

const settings = SyncSettingsSchema.parse({});
describe('同步过滤与路径边界', () => {
  it('默认只同步代码和不超过 10 MiB 的小文件', () => {
    expect(eligibleFile('src/train.py', 100, settings)).toBe(true);
    expect(eligibleFile('result.txt', 10 * 1024 * 1024, settings)).toBe(true);
    expect(eligibleFile('result.txt', 10 * 1024 * 1024 + 1, settings)).toBe(false);
    for (const file of ['.git/config', 'nested/.git/HEAD', 'model.PT', 'data.npy', 'dataset.h5', 'results.tar.gz'])
      expect(eligibleFile(file, 1, settings)).toBe(false);
  });
  it('自定义扩展名与过滤文本保持一致，.git 永远排除', () => {
    const changed = SyncSettingsSchema.parse({ excludedExtensions: ['csv'] });
    expect(eligibleFile('data.csv', 1, changed)).toBe(false);
    expect(eligibleFile('weights.pt', 1, changed)).toBe(true);
    expect(filterText(changed)).toContain('- .git/**');
    expect(filterText(changed)).toContain('- *.csv');
    expect(filterText(changed)).not.toContain('*.pt');
    expect(eligibleFile('.git', 20, changed)).toBe(false);
    expect(eligibleFile('nested/.git', 20, changed)).toBe(false);
    expect(filterText(changed)).toContain('- .git\n');
    expect(filterText(changed)).toContain('- **/.git\n');
  });
  it.each(['../a', '/a', 'C:/a', 'a\\b', 'a/../b', 'a\n--flag', 'a\0b', 'a//b', 'a:stream'])(
    '拒绝越界或不可表示的路径 %s',
    (file) => {
      expect(() => safeRelativePath(file)).toThrow();
    },
  );
  it('允许中文、空格及正常相对路径', () => {
    expect(safeRelativePath('结果/文件 1.txt')).toBe('结果/文件 1.txt');
  });
});
