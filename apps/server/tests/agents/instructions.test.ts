import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildInstructions } from '../../src/agents/instructions';

describe('buildInstructions', () => {
  it('包含服务器、目录、同步门禁和用户手动分析的约定', () => {
    const text = buildInstructions({
      id: 'w1',
      name: 'demo',
      localDir: path.join(os.tmpdir(), 'ssh-server-fixture', 'demo'),
      sshHost: 'my-server',
      remoteDir: '~/projects/demo',
    });
    expect(text).toContain('my-server');
    expect(text).toContain('~/projects/demo');
    expect(text).toContain('remote_exec');
    expect(text).toContain('remote_peek');
    expect(text).toContain('执行前');
    expect(text).toContain('sync_now');
    expect(text).toContain('用户');
    expect(text).toContain('已有的 Python');
    expect(text).not.toContain('尚未实现同步');
  });
});
