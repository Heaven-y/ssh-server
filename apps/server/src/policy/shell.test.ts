import { describe, expect, it } from 'vitest';
import { splitSegments } from './shell';

describe('splitSegments', () => {
  it('按未加引号的分隔符拆分，并去掉引号', () => {
    expect(splitSegments('echo "a; b" && ls | wc -l')).toEqual([['echo', 'a; b'], ['ls'], ['wc', '-l']]);
  });

  it('单引号内容原样保留', () => {
    expect(splitSegments("echo 'x && y'; pwd")).toEqual([['echo', 'x && y'], ['pwd']]);
  });

  it('换行、|| 和 & 也是分隔符', () => {
    expect(splitSegments('a\nb || c & d')).toEqual([['a'], ['b'], ['c'], ['d']]);
  });

  it('重定向符号单独成为一个参数', () => {
    expect(splitSegments('echo k >>~/.ssh/authorized_keys')).toEqual([['echo', 'k', '>>', '~/.ssh/authorized_keys']]);
  });

  it('反斜杠转义空格', () => {
    expect(splitSegments('ls a\\ b')).toEqual([['ls', 'a b']]);
  });

  it('丢弃空片段', () => {
    expect(splitSegments('ls ;; pwd')).toEqual([['ls'], ['pwd']]);
  });
});
