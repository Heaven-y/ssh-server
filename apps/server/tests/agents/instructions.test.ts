import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildInstructions } from '../../src/agents/instructions';

describe('buildInstructions', () => {
  it('只声明本地项目目录，不再提服务器、远端工具或 Slurm', () => {
    const localDir = path.join(os.tmpdir(), 'agentdeck-fixture', 'demo');
    const text = buildInstructions({
      id: 'w1',
      name: 'demo',
      localDir,
      sshHost: 'my-server',
      remoteDir: '~/projects/demo',
    });
    expect(text).toContain(localDir);
    // 桥已删除，CLI 没有任何触达服务器的通道，指令里不能再让它操作服务器
    expect(text).not.toContain('my-server');
    expect(text).not.toContain('~/projects/demo');
    expect(text).not.toContain('SSH');
    expect(text).not.toContain('remote_exec');
    expect(text).not.toContain('remote_peek');
    expect(text).not.toContain('sync_now');
    expect(text).not.toContain('nohup');
    expect(text).not.toContain('Slurm');
    // 关键语义：本机执行，而不是"不要在本地跑"
    expect(text).toContain('本机');
    expect(text).toContain('Bash');
  });
});
