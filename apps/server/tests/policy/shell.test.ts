import { describe, expect, it } from 'vitest';
import { splitSegments } from '../../src/policy/shell';

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

  it('&> 与 &>> 是重定向而不是后台运行', () => {
    expect(splitSegments('ls &>out; ls &>> log')).toEqual([
      ['ls', '&>', 'out'],
      ['ls', '&>>', 'log'],
    ]);
  });

  it('反斜杠加换行是续行，不拆分片段', () => {
    expect(splitSegments('rm -rf \\\n/')).toEqual([['rm', '-rf', '/']]);
  });

  it('双引号内只转义 " \\ $ `，其余反斜杠保留', () => {
    expect(splitSegments('echo "a\\"b\\n"')).toEqual([['echo', 'a"b\\n']]);
  });

  it('空引号是一个空字符串参数', () => {
    expect(splitSegments('echo \'\' ""')).toEqual([['echo', '', '']]);
  });

  it('未闭合的引号吃掉剩余内容，末尾反斜杠不报错', () => {
    expect(splitSegments("echo 'a; sudo x")).toEqual([['echo', 'a; sudo x']]);
    expect(splitSegments('echo a\\')).toEqual([['echo', 'a']]);
  });

  it('换行后的命令是新的片段（shell-quote 在这里会合并，见开发环境文档 1.2）', () => {
    expect(splitSegments('echo x\nsudo whoami')).toEqual([
      ['echo', 'x'],
      ['sudo', 'whoami'],
    ]);
  });
});
