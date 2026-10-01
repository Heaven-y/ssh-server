import { describe, expect, it } from 'vitest';
import { buildInstructions } from './instructions';

describe('buildInstructions', () => {
  it('包含服务器、目录、远程工具用法和"尚未同步"的提醒', () => {
    const text = buildInstructions({
      id: 'w1',
      name: 'demo',
      localDir: 'D:/w',
      sshHost: 'my-server',
      remoteDir: '~/projects/demo',
    });
    expect(text).toContain('my-server');
    expect(text).toContain('~/projects/demo');
    expect(text).toContain('remote_exec');
    expect(text).toContain('remote_peek');
    expect(text).toContain('尚未实现同步');
  });
});
