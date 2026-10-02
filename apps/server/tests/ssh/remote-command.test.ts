import { describe, expect, it } from 'vitest';
import { buildPeekCommand, buildRemoteCommand, sq } from '../../src/ssh/remote-command';

describe('sq', () => {
  it('用 POSIX 单引号包裹并转义内部单引号', () => {
    expect(sq("it's")).toBe("'it'\\''s'");
    expect(sq('a b')).toBe("'a b'");
  });
});

describe('buildRemoteCommand', () => {
  it('绝对路径目录', () => {
    expect(buildRemoteCommand('/data/a b', 'ls -la', 600)).toBe("cd '/data/a b' && exec timeout 600 bash -lc 'ls -la'");
  });

  it('~ 开头的目录用 $HOME 展开，命令中的单引号被转义', () => {
    expect(buildRemoteCommand('~/p q', "echo 'x'", 60)).toBe(
      "cd \"$HOME\"/'p q' && exec timeout 60 bash -lc 'echo '\\''x'\\'''",
    );
  });

  it('目录为 ~ 时直接进入家目录', () => {
    expect(buildRemoteCommand('~', 'pwd', 60)).toBe('cd "$HOME" && exec timeout 60 bash -lc \'pwd\'');
  });

  it('命令中的换行原样交给 bash', () => {
    expect(() => buildRemoteCommand('/a', 'ls\nrm x', 60)).not.toThrow();
  });

  it('目录含换行或超时不是正整数时抛错', () => {
    expect(() => buildRemoteCommand('/a\nb', 'ls', 60)).toThrow();
    expect(() => buildRemoteCommand('/a', 'ls', 0)).toThrow();
  });
});

describe('buildPeekCommand', () => {
  it('head 在服务器目录下读取相对路径', () => {
    const cmd = buildPeekCommand('~/p', 'logs/a.txt', 'head', 50);
    expect(cmd.startsWith('cd "$HOME"/\'p\' && ')).toBe(true);
    expect(cmd).toContain("head -n 50 -- 'logs/a.txt'");
  });

  it('du 带 30 秒超时', () => {
    expect(buildPeekCommand('/data', '/data/big', 'du')).toContain("timeout 30 du -sh -- '/data/big'");
  });

  it('stat 输出类型、大小、修改时间', () => {
    expect(buildPeekCommand('/data', 'a.pkl', 'stat')).toContain("stat -c '%F|%s|%y|%n' -- 'a.pkl'");
  });

  it('行数超过 200 时抛错', () => {
    expect(() => buildPeekCommand('/data', 'a', 'tail', 201)).toThrow();
  });
});
