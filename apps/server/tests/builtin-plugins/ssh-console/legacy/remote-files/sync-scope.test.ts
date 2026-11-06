// 从已删除的 tests/sync/filters.test.ts 搬来的路径边界与过滤用例；只覆盖仍保留的三个纯函数。
import { describe, expect, it } from 'vitest';
import { RemoteFileFilterSchema } from '@agentdeck/shared/ssh';
import {
  eligibleFile,
  excludedPath,
  safeRelativePath,
} from '../../../../../src/builtin-plugins/ssh-console/legacy/remote-files/sync-scope';

const settings = RemoteFileFilterSchema.parse({});
describe('远端条目的同步范围判定', () => {
  it('默认只看代码和不超过 10 MiB 的小文件', () => {
    expect(eligibleFile('src/train.py', 100, settings)).toBe(true);
    expect(eligibleFile('result.txt', 10 * 1024 * 1024, settings)).toBe(true);
    expect(eligibleFile('result.txt', 10 * 1024 * 1024 + 1, settings)).toBe(false);
    for (const file of ['.git/config', 'nested/.git/HEAD', 'model.PT', 'data.npy', 'dataset.h5', 'results.tar.gz'])
      expect(eligibleFile(file, 1, settings)).toBe(false);
  });
  it('自定义扩展名生效，.git 永远排除', () => {
    const changed = RemoteFileFilterSchema.parse({ excludedExtensions: ['csv'] });
    expect(eligibleFile('data.csv', 1, changed)).toBe(false);
    expect(eligibleFile('weights.pt', 1, changed)).toBe(true);
    expect(excludedPath('data.csv', changed)).toBe(true);
    expect(excludedPath('weights.pt', changed)).toBe(false);
    expect(eligibleFile('.git', 20, changed)).toBe(false);
    expect(eligibleFile('nested/.git', 20, changed)).toBe(false);
  });
  it.each(['../a', '/a', 'C:/a', 'a\\b', 'a/../b', 'a\n--flag', 'a\0b', 'a//b', 'a:stream'])(
    '拒绝越界或不可表示的路径 %s',
    (file) => {
      expect(() => safeRelativePath(file)).toThrow();
    },
  );
  it.each(['con/a', 'aux', 'lpt1.txt', 'NUL.log'])('拒绝系统保留文件名 %s', (file) => {
    expect(() => safeRelativePath(file)).toThrow('系统保留文件名');
  });
  it('允许中文、空格及正常相对路径', () => {
    expect(safeRelativePath('结果/文件 1.txt')).toBe('结果/文件 1.txt');
  });
});
