import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { workspaceTerminalTarget, type Workspace } from '@ssh-server/shared';
import { createSlurmService } from '../../src/slurm/service';
import type { ResolvedConnection } from '../../src/ssh/connection';
import type { SshPool } from '../../src/ssh/pool';
import { deferred, SlurmChannel, slurmHeader, slurmOutput } from './fixture';

const services: ReturnType<typeof createSlurmService>[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  vi.useRealTimers();
});
function fixture() {
  let workspace: Workspace | undefined = {
    id: 'w',
    name: '合成工作区',
    localDir: path.resolve('fixture'),
    sshHost: 'my-server',
    remoteDir: '~/projects/demo',
  };
  let connection: ResolvedConnection = {
    alias: 'my-server',
    hostname: 'fixture-node',
    port: 22,
    username: 'demo',
    authMode: 'password',
    password: 'fixture-password',
    cacheKey: 'fixture-cache-key',
    knownHosts: 'fixture-trust',
    knownHostsFile: 'fixture-known-hosts',
  };
  let generation = 0;
  const listeners = new Set<() => void>();
  const channels: SlurmChannel[] = [];
  const getWorkspace = vi.fn(async () => (workspace ? { ...workspace } : undefined));
  const resolveConnection = vi.fn(async () => ({ ...connection }));
  const openExec = vi.fn(async () => {
    const channel = new SlurmChannel();
    channels.push(channel);
    return channel.asClient();
  });
  const disconnect = vi.fn();
  const pool = {
    resolveConnection,
    openExec,
    disconnect,
    generation: () => generation,
    onCredentialsChanged: (_alias: string, notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
  } as unknown as SshPool;
  const service = createSlurmService({ store: { get: getWorkspace }, pool });
  services.push(service);
  const target = workspaceTerminalTarget(workspace);
  return {
    service,
    target,
    openExec,
    resolveConnection,
    getWorkspace,
    listeners,
    disconnect,
    async ready(index = 0) {
      await vi.waitFor(() => expect(channels[index]?.listenerCount('data')).toBeGreaterThan(0), { interval: 10 });
      return channels[index]!;
    },
    changeConnection(value: Partial<ResolvedConnection>) {
      connection = { ...connection, ...value };
    },
    changeWorkspace(value?: Partial<Workspace>) {
      workspace = value ? { ...workspace!, ...value } : undefined;
    },
    changeGeneration() {
      generation++;
      for (const notify of listeners) notify();
    },
  };
}
const signal = () => new AbortController().signal;

it('首次请求才查询，短缓存命中后手动刷新；没有后台轮询或认证字段返回', async () => {
  vi.useFakeTimers();
  const f = fixture();
  expect(f.openExec).not.toHaveBeenCalled();
  const pending = f.service.get(f.target, signal());
  (await f.ready()).finish(slurmOutput());
  const first = await pending;
  expect(first).toMatchObject({ status: 'available', output: `${slurmHeader}\n${slurmOutput().trimEnd()}` });
  expect(await f.service.get(f.target, signal())).toEqual(first);
  expect(f.openExec).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(first)).not.toMatch(/fixture-password|fixture-cache-key|fixture-trust|samplingKey|generation/);
  await vi.advanceTimersByTimeAsync(1999);
  expect(await f.service.get(f.target, signal())).toEqual(first);
  expect(f.openExec).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  const refresh = f.service.get(f.target, signal());
  (await f.ready(1)).finish(slurmOutput(102));
  expect((await refresh).output).toContain(slurmOutput(102).trimEnd());
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.openExec).toHaveBeenCalledTimes(2);
  expect(f.disconnect).not.toHaveBeenCalled();
});

it('同固定目标共享 pending；取消一个调用者不取消其他等待者', async () => {
  const f = fixture();
  const a = new AbortController();
  const first = f.service.get(f.target, a.signal).catch((error: unknown) => error);
  const second = f.service.get(f.target, signal());
  const channel = await f.ready();
  a.abort();
  expect(await first).toMatchObject({ name: 'AbortError' });
  expect(channel.close).not.toHaveBeenCalled();
  channel.finish(slurmOutput());
  expect((await second).status).toBe('available');
  expect(f.openExec).toHaveBeenCalledTimes(1);
  expect(f.listeners.size).toBe(0);
});

it('最后一个等待者取消才关闭查询，下次请求不复用已取消的 pending', async () => {
  const f = fixture();
  const controller = new AbortController();
  const pending = f.service.get(f.target, controller.signal).catch((error: unknown) => error);
  const channel = await f.ready();
  controller.abort();
  expect(await pending).toMatchObject({ name: 'AbortError' });
  expect(channel.close).toHaveBeenCalled();
  const next = f.service.get(f.target, signal());
  (await f.ready(1)).finish(slurmOutput(202));
  expect((await next).output).toContain(slurmOutput(202).trimEnd());
  expect(f.disconnect).not.toHaveBeenCalled();
});

it.each([
  { hostname: 'another-fixture-node' },
  { port: 2222 },
  { username: 'other-demo' },
  { password: 'new-fixture-password' },
  { authMode: 'key' as const, privateKey: Buffer.from('fixture-key') },
  { knownHosts: 'changed-fixture-trust' },
  { cacheKey: 'changed-cache-key' },
])('同别名真实连接/认证变化拒绝旧结果，不污染新查询：%j', async (change) => {
  const f = fixture();
  const pending = f.service.get(f.target, signal()).catch((error: unknown) => error);
  const channel = await f.ready();
  f.changeConnection(change);
  channel.finish(slurmOutput());
  expect(await pending).toMatchObject({ code: 'target_changed' });
  const next = f.service.get(f.target, signal());
  (await f.ready(1)).finish(slurmOutput(303));
  expect((await next).output).toContain(slurmOutput(303).trimEnd());
});

it('密码相同但认证代次变化也拒绝，不能用密码摘要命中旧缓存', async () => {
  const f = fixture();
  const pending = f.service.get(f.target, signal()).catch((error: unknown) => error);
  const channel = await f.ready();
  f.changeGeneration();
  expect(await pending).toMatchObject({ code: 'target_changed' });
  expect(channel.close).toHaveBeenCalled();
  const next = f.service.get(f.target, signal());
  (await f.ready(1)).finish(slurmOutput(404));
  expect((await next).output).toContain(slurmOutput(404).trimEnd());
});

it('已完成缓存也按认证代次隔离', async () => {
  const f = fixture();
  const first = f.service.get(f.target, signal());
  (await f.ready()).finish(slurmOutput());
  await first;
  f.changeGeneration();
  const next = f.service.get(f.target, signal());
  (await f.ready(1)).finish(slurmOutput(405));
  expect((await next).output).toContain(slurmOutput(405).trimEnd());
});

it.each([3, 4])('采样后/返回前第 %i 次解析期间目录变化仍拒绝', async (blockedCall) => {
  const f = fixture();
  const blocked = deferred<void>();
  const resume = deferred<void>();
  const original = f.resolveConnection.getMockImplementation()!;
  let calls = 0;
  f.resolveConnection.mockImplementation(async () => {
    const result = await original();
    if (++calls === blockedCall) {
      blocked.resolve();
      await resume.promise;
    }
    return result;
  });
  const pending = f.service.get(f.target, signal()).catch((error: unknown) => error);
  (await f.ready()).finish(slurmOutput());
  await blocked.promise;
  f.changeWorkspace({ remoteDir: '~/projects/changed' });
  resume.resolve();
  expect(await pending).toMatchObject({ code: 'target_changed' });
});

it('解析前后检查固定目标，工作区缺失/别名不符均不执行 SSH', async () => {
  const f = fixture();
  await expect(f.service.get({ ...f.target, sshHost: 'other-server' }, signal())).rejects.toMatchObject({
    code: 'target_changed',
  });
  f.changeWorkspace();
  await expect(f.service.get(f.target, signal())).rejects.toMatchObject({ code: 'workspace_missing' });
  expect(f.openExec).not.toHaveBeenCalled();
});

it('等待连接解析时取消立即结束，不等待底层解析也不打开查询', async () => {
  const f = fixture();
  const barrier = deferred<ResolvedConnection>();
  f.resolveConnection.mockImplementation(() => barrier.promise);
  const controller = new AbortController();
  const pending = f.service.get(f.target, controller.signal).catch((error: unknown) => error);
  await vi.waitFor(() => expect(f.resolveConnection).toHaveBeenCalledOnce());
  controller.abort();
  expect(await pending).toMatchObject({ name: 'AbortError' });
  expect(f.openExec).not.toHaveBeenCalled();
});

it('SSH 失败只返回脱敏错误摘要；错误不缓存，手动请求可以恢复', async () => {
  const f = fixture();
  const pending = f.service.get(f.target, signal());
  (await f.ready()).finish('', 1, 'private-controller-error');
  expect(await pending).toMatchObject({ status: 'error', output: '', message: expect.any(String) });
  expect(JSON.stringify(await pending)).not.toContain('private-controller-error');
  const next = f.service.get(f.target, signal());
  (await f.ready(1)).finish('');
  expect(await next).toMatchObject({ status: 'available', output: '' });
});

it('关闭服务释放查询与监听但不断开共享 SSH，后续请求拒绝', async () => {
  const f = fixture();
  const pending = f.service.get(f.target, signal()).catch((error: unknown) => error);
  const channel = await f.ready();
  f.service.dispose();
  expect(await pending).toBeInstanceOf(Error);
  expect(channel.close).toHaveBeenCalled();
  await vi.waitFor(() => expect(f.listeners.size).toBe(0));
  await expect(f.service.get(f.target, signal())).rejects.toThrow();
  expect(f.disconnect).not.toHaveBeenCalled();
});

it.each([1, 3, 4])('8 秒预算也覆盖第 %i 次目标读取，迟到解析不得延长请求', async (blockedCall) => {
  vi.useFakeTimers();
  const f = fixture();
  const reached = deferred<void>();
  const barrier = deferred<ResolvedConnection>();
  const resolve = f.resolveConnection.getMockImplementation()!;
  let calls = 0;
  f.resolveConnection.mockImplementation(async () => {
    if (++calls === blockedCall) {
      reached.resolve();
      return barrier.promise;
    }
    return resolve();
  });
  const finished = vi.fn();
  void f.service.get(f.target, signal()).then(finished, finished);
  if (blockedCall !== 1) (await f.ready()).finish(slurmOutput());
  await reached.promise;
  await vi.advanceTimersByTimeAsync(8000);
  expect(finished).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ status: 'error', output: '', message: expect.stringContaining('超时') }),
  );
  expect(f.disconnect).not.toHaveBeenCalled();
});

it.each(['', slurmOutput()])('成功警告贯穿服务与缓存，但原始 stderr 不返回：%j', async (stdout) => {
  const f = fixture();
  const pending = f.service.get(f.target, signal());
  (await f.ready()).finish(stdout, 0, 'private-controller-warning');
  const result = await pending;
  expect(result).toMatchObject({
    status: 'available',
    output: stdout ? `${slurmHeader}\n${stdout.trimEnd()}` : '',
    message: 'Slurm 返回警告，结果可能不完整',
  });
  expect(JSON.stringify(result)).not.toContain('private-controller-warning');
  expect(await f.service.get(f.target, signal())).toEqual(result);
  expect(f.openExec).toHaveBeenCalledOnce();
});

it('未安装仍沿用两秒短缓存，不因协议改成文本而改缓存策略', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const pending = f.service.get(f.target, signal());
  (await f.ready()).finish('', 127);
  const unavailable = await pending;
  expect(unavailable).toMatchObject({ status: 'unavailable', output: '' });
  await vi.advanceTimersByTimeAsync(1999);
  expect(await f.service.get(f.target, signal())).toEqual(unavailable);
  expect(f.openExec).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  const next = f.service.get(f.target, signal());
  (await f.ready(1)).finish('');
  expect(await next).toMatchObject({ status: 'available', output: '' });
  expect(f.openExec).toHaveBeenCalledTimes(2);
});

it('最多保留 32 个未过期快照，新目标挤出最早完成项', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const started = Date.now();
  for (let i = 0; i < 33; i++) {
    const remoteDir = `~/projects/fixture-${i}`;
    f.changeWorkspace({ remoteDir });
    const pending = f.service.get({ ...f.target, remoteDir }, signal());
    (await f.ready(i)).finish(slurmOutput(i + 1));
    expect((await pending).status).toBe('available');
  }
  expect(Date.now() - started).toBeLessThan(2000);
  const remoteDir = '~/projects/fixture-0';
  f.changeWorkspace({ remoteDir });
  const next = f.service.get({ ...f.target, remoteDir }, signal());
  (await f.ready(33)).finish(slurmOutput(999));
  expect((await next).output).toContain(slurmOutput(999).trimEnd());
  expect(f.openExec).toHaveBeenCalledTimes(34);
});

it('32 个在途目标已占满时拒绝第 33 个，不驱逐仍有等待者的通道', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const controllers: AbortController[] = [];
  const pending: Promise<unknown>[] = [];
  for (let i = 0; i < 32; i++) {
    const controller = new AbortController();
    controllers.push(controller);
    const remoteDir = `~/projects/fixture-${i}`;
    f.changeWorkspace({ remoteDir });
    pending.push(f.service.get({ ...f.target, remoteDir }, controller.signal).catch((error: unknown) => error));
    expect((await f.ready(i)).close).not.toHaveBeenCalled();
  }
  const remoteDir = '~/projects/fixture-full';
  f.changeWorkspace({ remoteDir });
  expect(await f.service.get({ ...f.target, remoteDir }, signal())).toMatchObject({
    status: 'error',
    output: '',
    message: expect.stringContaining('名额已满'),
  });
  expect(f.openExec).toHaveBeenCalledTimes(32);
  for (const controller of controllers) controller.abort();
  for (const result of await Promise.all(pending)) expect(result).toMatchObject({ name: 'AbortError' });
  expect(f.disconnect).not.toHaveBeenCalled();
});
