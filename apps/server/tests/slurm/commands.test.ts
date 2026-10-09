import { afterEach, expect, it, vi } from 'vitest';
import { querySlurm } from '../../src/slurm/commands';
import type { SshPool } from '../../src/ssh/pool';
import { deferred, SlurmChannel, slurmOutput } from './fixture';

afterEach(() => vi.useRealTimers());
const target = { alias: 'my-server' };
function fixture() {
  const channel = new SlurmChannel();
  const openExec = vi.fn(async () => channel.asClient());
  const disconnect = vi.fn();
  const pool = { openExec, disconnect } as unknown as SshPool;
  const controller = new AbortController();
  return { channel, openExec, disconnect, pool, controller };
}
const ready = (channel: SlurmChannel) => vi.waitFor(() => expect(channel.listenerCount('data')).toBeGreaterThan(0));

it('只发唯一当前 SSH 账号固定格式文本查询，不依赖环境列格式或拼接用户输入', async () => {
  const f = fixture();
  const pending = querySlurm(f.pool, target, f.controller.signal);
  await ready(f.channel);
  f.channel.finish(slurmOutput());
  expect(f.openExec).toHaveBeenCalledExactlyOnceWith(
    target,
    'LC_ALL=C squeue --noheader --user="$(id -un)" --format="%.18i %.9P %.24j %.8u %.2t %.10M %.6D %R"',
    expect.any(AbortSignal),
  );
  expect(await pending).toEqual({ stdout: slurmOutput(), warning: false });
  f.controller.abort();
  expect(f.channel.close).not.toHaveBeenCalled();
  expect(f.disconnect).not.toHaveBeenCalled();
});

it.each([
  { exit: 127, stderr: 'sh: squeue: command not found', status: 'unavailable' },
  { exit: 2, stderr: 'squeue: invalid option in fixture', status: 'error' },
  { exit: 255, stderr: 'private-ssh-details', status: 'error' },
  { exit: 1, stderr: 'squeue: error: Unable to contact slurm controller', status: 'error' },
  { exit: 1, stderr: 'squeue: error: Access/permission denied', status: 'error' },
  { exit: 1, stderr: 'private-server-secret', status: 'error' },
])('未安装与非零退出的查询失败分开，不执行备用命令：%j', async ({ exit, stderr, status }) => {
  const f = fixture();
  const pending = querySlurm(f.pool, target, f.controller.signal).catch((error: unknown) => error);
  await ready(f.channel);
  f.channel.finish('', exit, stderr);
  expect(await pending).toMatchObject({ status, message: expect.any(String) });
  expect(String(await pending)).not.toContain(stderr);
  expect(f.openExec).toHaveBeenCalledTimes(1);
  expect(f.disconnect).not.toHaveBeenCalled();
});

it.each(['', slurmOutput()])('成功 stderr 警告独立保留，即使 stdout 为空也不能丢弃：%j', async (stdout) => {
  const f = fixture();
  const pending = querySlurm(f.pool, target, f.controller.signal);
  await ready(f.channel);
  f.channel.finish(stdout, 0, 'private-controller-warning');
  expect(await pending).toEqual({ stdout, warning: true });
  expect(JSON.stringify(await pending)).not.toContain('private-controller-warning');
  expect(f.openExec).toHaveBeenCalledOnce();
});

it('成功空 stdout 原样返回，不尝试解析或添加伪造内容', async () => {
  const f = fixture();
  const pending = querySlurm(f.pool, target, f.controller.signal);
  await ready(f.channel);
  f.channel.finish('');
  expect(await pending).toEqual({ stdout: '', warning: false });
});

it('8 秒超时只关闭作业通道，迟到结果不变成成功', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const pending = querySlurm(f.pool, target, f.controller.signal).catch((error: unknown) => error);
  await ready(f.channel);
  await vi.advanceTimersByTimeAsync(8000);
  expect(await pending).toMatchObject({ status: 'error', message: expect.stringContaining('超时') });
  expect(f.channel.close).toHaveBeenCalled();
  f.channel.finish(slurmOutput());
  expect(f.disconnect).not.toHaveBeenCalled();
});

it('打开通道也受 8 秒限制，迟到通道关闭', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const opened = deferred<ReturnType<SlurmChannel['asClient']>>();
  f.openExec.mockImplementation(() => opened.promise);
  const pending = querySlurm(f.pool, target, f.controller.signal).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(8000);
  expect(await pending).toMatchObject({ status: 'error' });
  opened.resolve(f.channel.asClient());
  await vi.waitFor(() => expect(f.channel.close).toHaveBeenCalled());
  expect(f.disconnect).not.toHaveBeenCalled();
});

it('stdout/stderr 共用 512 KiB 预算，超过立即关闭并拒绝完整性不足的数据', async () => {
  const f = fixture();
  const pending = querySlurm(f.pool, target, f.controller.signal).catch((error: unknown) => error);
  await ready(f.channel);
  f.channel.emit('data', Buffer.alloc(300 * 1024, 32));
  expect(f.channel.close).not.toHaveBeenCalled();
  f.channel.stderr.emit('data', Buffer.alloc(213 * 1024, 32));
  expect(await pending).toMatchObject({ status: 'error', message: expect.stringContaining('512') });
  expect(f.channel.close).toHaveBeenCalled();
  expect(f.disconnect).not.toHaveBeenCalled();
});

it('stdout/stderr 合计恰好 512 KiB 可读取；UTF-8 多字节超限整份拒绝', async () => {
  const f = fixture();
  const pending = querySlurm(f.pool, target, f.controller.signal);
  await ready(f.channel);
  const stdout = 'x'.repeat(512 * 1024 - 1);
  f.channel.finish(stdout, 0, '!');
  expect(await pending).toEqual({ stdout, warning: true });
  expect(f.channel.close).not.toHaveBeenCalled();
  const g = fixture();
  const rejected = querySlurm(g.pool, target, g.controller.signal).catch((error: unknown) => error);
  await ready(g.channel);
  g.channel.finish('中'.repeat(180_000));
  expect(await rejected).toMatchObject({ status: 'error', message: expect.stringContaining('512 KiB') });
  expect(g.channel.close).toHaveBeenCalled();
});

it('预先取消不打开通道，在途取消立即拒绝且不影响共享连接', async () => {
  const f = fixture();
  const pending = querySlurm(f.pool, target, f.controller.signal).catch((error: unknown) => error);
  await ready(f.channel);
  f.controller.abort();
  expect(await pending).toMatchObject({ name: 'AbortError' });
  expect(f.channel.close).toHaveBeenCalled();
  await expect(querySlurm(f.pool, target, f.controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.openExec).toHaveBeenCalledTimes(1);
  expect(f.disconnect).not.toHaveBeenCalled();
});

it('通道错误与未知退出码都不产生成功数据', async () => {
  const f = fixture();
  const pending = querySlurm(f.pool, target, f.controller.signal).catch((error: unknown) => error);
  await ready(f.channel);
  f.channel.emit('error', new Error('private-ssh-error'));
  expect(await pending).toMatchObject({ status: 'error' });
  const g = fixture();
  const unknown = querySlurm(g.pool, target, g.controller.signal).catch((error: unknown) => error);
  await ready(g.channel);
  g.channel.emit('data', Buffer.from(slurmOutput()));
  g.channel.emit('close');
  expect(await unknown).toMatchObject({ status: 'error' });
});
