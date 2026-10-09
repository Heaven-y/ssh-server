import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { workspaceTerminalTarget, type Workspace } from '@ssh-server/shared';
import { createResourceTargetContext } from '../../src/resources/target';
import type { ResolvedConnection } from '../../src/ssh/connection';
import type { SshPool } from '../../src/ssh/pool';
import { deferred } from '../slurm/fixture';

function fixture() {
  let workspace: Workspace | undefined = {
    id: 'w',
    name: '夹具',
    localDir: path.resolve('fixture'),
    sshHost: 'my-server',
    remoteDir: '~/projects/demo',
  };
  let generation = 1;
  const connection: ResolvedConnection = {
    alias: 'my-server',
    hostname: 'fixture-node',
    port: 22,
    username: 'demo',
    authMode: 'password',
    password: 'fixture-password',
    knownHosts: 'fixture-trust',
    knownHostsFile: 'fixture-file',
    cacheKey: 'fixture-key',
  };
  const resolve = vi.fn(async () => ({ ...connection }));
  const get = vi.fn(async () => (workspace ? { ...workspace } : undefined));
  const context = createResourceTargetContext({
    store: { get },
    pool: { resolveConnection: resolve, generation: () => generation } as unknown as SshPool,
  });
  return {
    context,
    resolve,
    get,
    connection,
    target: workspaceTerminalTarget(workspace),
    changeGeneration: () => {
      generation++;
    },
    changeWorkspace: (value?: Partial<Workspace>) => {
      workspace = value ? { ...workspace!, ...value } : undefined;
    },
  };
}

it('共享上下文仅保留实际 key、认证代次与摘要，不携带密码或私钥', async () => {
  const f = fixture();
  const context = await f.context(f.target);
  expect(context).toMatchObject({ key: 'fixture-key', generation: 1, samplingKey: expect.any(String) });
  expect(JSON.stringify(context)).not.toContain('fixture-password');
  expect(context).not.toHaveProperty('connection');
});

it.each(['cacheKey', 'password', 'knownHosts'] as const)(
  '复验 %s 变化，不能仅凭工作区别名认定目标未变',
  async (field) => {
    const f = fixture();
    const initial = await f.context(f.target);
    f.connection[field] = 'changed-fixture';
    await expect(f.context(f.target, initial)).rejects.toMatchObject({ code: 'target_changed' });
  },
);

it('相同实际密钥内容不代表相同认证代次', async () => {
  const f = fixture();
  const initial = await f.context(f.target);
  f.changeGeneration();
  await expect(f.context(f.target, initial)).rejects.toMatchObject({ code: 'target_changed' });
});

it.each(['generation', 'directory', 'deleted'] as const)('异步连接读取之后重新核对 %s', async (change) => {
  const f = fixture();
  const barrier = deferred<ResolvedConnection>();
  f.resolve.mockImplementation(() => barrier.promise);
  const pending = f.context(f.target).catch((error: unknown) => error);
  await vi.waitFor(() => expect(f.resolve).toHaveBeenCalledOnce());
  if (change === 'generation') f.changeGeneration();
  else if (change === 'directory') f.changeWorkspace({ remoteDir: '~/projects/changed' });
  else f.changeWorkspace();
  barrier.resolve(f.connection);
  expect(await pending).toMatchObject({ code: change === 'deleted' ? 'workspace_missing' : 'target_changed' });
});

it('工作区读取开始前固定认证代次，读取过程中替换密码也必须拒绝', async () => {
  const f = fixture();
  const get = f.get.getMockImplementation()!;
  f.get.mockImplementationOnce(async () => {
    f.changeGeneration();
    return get();
  });
  await expect(f.context(f.target)).rejects.toMatchObject({ code: 'target_changed' });
  expect(f.resolve).not.toHaveBeenCalled();
});

it('共享上下文绑定原始输入，不能把旧连接上下文用于新目录目标', async () => {
  const f = fixture();
  const initial = await f.context(f.target);
  f.changeWorkspace({ remoteDir: '~/projects/changed' });
  await expect(f.context({ ...f.target, remoteDir: '~/projects/changed' }, initial)).rejects.toMatchObject({
    code: 'target_changed',
  });
});
