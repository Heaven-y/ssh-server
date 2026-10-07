import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { RESOURCE_LIMITS } from '@ssh-server/shared';
import { sampleResourceCommand } from '../../src/resources/sample';
import { runExec, type ExecResult } from '../../src/ssh/exec';
import type { SshPool } from '../../src/ssh/pool';

vi.mock('../../src/ssh/exec', () => ({ runExec: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const target = { alias: 'my-server' };
const success: ExecResult = {
  stdout: '采样结果',
  stderr: '',
  exitCode: 0,
  timedOut: false,
  truncated: false,
  durationMs: 1,
};
function fixture() {
  const channel = Object.assign(new EventEmitter(), { close: vi.fn() });
  const openExec = vi.fn(async () => channel);
  const disconnect = vi.fn();
  const pool = { openExec, disconnect } as unknown as SshPool;
  const controller = new AbortController();
  vi.mocked(runExec).mockImplementation(async (open, command) => {
    await open(command);
    return success;
  });
  return { pool, openExec, disconnect, channel, controller };
}

it('显式传递采样signal、超时和输出上限，结束后移除取消监听', async () => {
  const f = fixture();
  const options = { signal: f.controller.signal, timeoutMs: 1234 };
  expect(await sampleResourceCommand(f.pool, target, 'sample', options)).toBe('采样结果');
  expect(f.openExec).toHaveBeenCalledExactlyOnceWith(target, 'sample', options.signal);
  expect(runExec).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'sample', {
    localTimeoutMs: 1234,
    outputCap: RESOURCE_LIMITS.outputBytes,
  });
  f.controller.abort();
  expect(f.channel.close).not.toHaveBeenCalled();
  expect(f.disconnect).not.toHaveBeenCalled();
});

it('取消仅关闭采样通道，不断开共享SSH', async () => {
  const f = fixture();
  vi.mocked(runExec).mockImplementation(async (open, command) => {
    await open(command);
    f.controller.abort();
    return success;
  });
  await expect(
    sampleResourceCommand(f.pool, target, 'sample', { signal: f.controller.signal, timeoutMs: 10 }),
  ).rejects.toThrow();
  expect(f.channel.close).toHaveBeenCalledOnce();
  expect(f.disconnect).not.toHaveBeenCalled();
});

it('预先取消不打开通道', async () => {
  const f = fixture();
  f.controller.abort();
  await expect(
    sampleResourceCommand(f.pool, target, 'sample', { signal: f.controller.signal, timeoutMs: 10 }),
  ).rejects.toThrow();
  expect(f.openExec).not.toHaveBeenCalled();
});

it.each([{ exitCode: 1 }, { timedOut: true }, { truncated: true }])('失败采样不返回成功结果：%j', async (failure) => {
  const f = fixture();
  vi.mocked(runExec).mockResolvedValue({ ...success, ...failure });
  await expect(
    sampleResourceCommand(f.pool, target, 'sample', { signal: f.controller.signal, timeoutMs: 10 }),
  ).rejects.toThrow('资源采样未完成');
  expect(f.disconnect).not.toHaveBeenCalled();
});
