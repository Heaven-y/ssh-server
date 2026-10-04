import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { workspaceTerminalTarget, type Workspace } from '@ssh-server/shared';
import { createResourcesService } from '../../src/resources/service';
import { sampleResourceCommand } from '../../src/resources/sample';
import type { SshPool } from '../../src/ssh/pool';
import { targetAlias } from '../../src/ssh/connection';
import { resourceFixtureOutput } from '../../../../scripts/dev/resource-fixture';

vi.mock('../../src/resources/sample', () => ({ sampleResourceCommand: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const workspace: Workspace = {
  id: 'w',
  name: '示例',
  localDir: path.resolve('fixture'),
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
};
function fixture(blockCall?: number) {
  let current: Workspace | undefined = workspace;
  let calls = 0;
  let unblock!: () => void;
  let reached!: () => void;
  const barrier = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const pool = {
    resolveConnection: async (target: Parameters<SshPool['resolveConnection']>[0]) => {
      if (++calls === blockCall) {
        reached();
        await barrier;
      }
      const alias = targetAlias(target);
      return {
        alias,
        hostname: 'fixture-node',
        port: 22,
        username: 'demo',
        authMode: 'key',
        privateKey: Buffer.from('fixture-key'),
        knownHosts: 'fixture-known',
        knownHostsFile: 'fixture-known',
        cacheKey: alias,
      };
    },
    generation: () => 0,
    onCredentialsChanged: () => () => undefined,
  } as unknown as SshPool;
  vi.mocked(sampleResourceCommand).mockImplementation(async (_pool, _target, command) =>
    command.includes('/proc/stat') ? resourceFixtureOutput(1) : '/dev/demo 10000 4000 6000 40% demo',
  );
  const service = createResourcesService({
    pool,
    store: { get: async (id) => (current ? { ...current, id } : undefined) },
  });
  return {
    service,
    blocked,
    unblock,
    change: (value: Workspace | undefined) => {
      current = value;
    },
  };
}

it('最后一次连接解析期间目录改变，旧请求必须拒绝', async () => {
  // 初始解析、宿主/磁盘前后解析、最后复验，共第六次解析。
  const f = fixture(6);
  try {
    const result = f.service.get(workspaceTerminalTarget(workspace)).then(
      () => null,
      (error: unknown) => error,
    );
    await f.blocked;
    f.change({ ...workspace, remoteDir: '~/projects/changed' });
    f.unblock();
    expect(await result).toMatchObject({ code: 'target_changed' });
  } finally {
    f.unblock();
    f.service.dispose();
  }
});

it('采样后解析期间删除工作区，旧宿主结果不能成为共享缓存', async () => {
  const f = fixture(4);
  try {
    const result = f.service.get(workspaceTerminalTarget(workspace)).then(
      () => null,
      (error: unknown) => error,
    );
    await f.blocked;
    f.change(undefined);
    f.unblock();
    expect(await result).toMatchObject({ code: 'workspace_missing' });
    f.change(workspace);
    const next = await f.service.get(workspaceTerminalTarget(workspace));
    expect(next.host.data).toBeNull();
    expect(next.host.stale).toBe(true);
  } finally {
    f.unblock();
    f.service.dispose();
  }
});

it('不同别名映射同实际认证共享宿主，磁盘按目录独立', async () => {
  const f = fixture();
  try {
    const first = workspaceTerminalTarget(workspace);
    const second = workspaceTerminalTarget({ ...workspace, id: 'other' });
    const reads = await Promise.all([f.service.get(first), f.service.get(second)]);
    expect(reads[0].host.sampledAt).toBe(reads[1].host.sampledAt);
    expect(vi.mocked(sampleResourceCommand).mock.calls).toHaveLength(2);
    f.change({ ...workspace, sshHost: 'same-node', remoteDir: '~/projects/other' });
    await f.service.get(
      workspaceTerminalTarget({ ...workspace, id: 'third', sshHost: 'same-node', remoteDir: '~/projects/other' }),
    );
    const commands = vi.mocked(sampleResourceCommand).mock.calls.map((call) => call[2]);
    expect(commands.filter((command) => command.includes('/proc/stat'))).toHaveLength(1);
    expect(commands.filter((command) => command.includes('df -Pk'))).toHaveLength(2);
  } finally {
    f.service.dispose();
  }
});
