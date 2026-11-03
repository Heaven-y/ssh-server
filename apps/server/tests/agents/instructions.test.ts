import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildInstructions } from '../../src/agents/instructions';

describe('buildInstructions', () => {
  it('包含服务器、目录与用户手动分析的约定，不再提远端工具', () => {
    const text = buildInstructions({
      id: 'w1',
      name: 'demo',
      localDir: path.join(os.tmpdir(), 'agentdeck-fixture', 'demo'),
      sshHost: 'my-server',
      remoteDir: '~/projects/demo',
    });
    expect(text).toContain('my-server');
    expect(text).toContain('~/projects/demo');
    expect(text).not.toContain('remote_exec');
    expect(text).not.toContain('remote_peek');
    expect(text).toContain('用户');
    expect(text).toContain('已有的 Python');
    expect(text).not.toContain('sync_now');
    expect(text).not.toContain('执行前');
  });
});
