import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runExec, type ChannelLike } from './exec';

function fakeChannel() {
  const ch = new EventEmitter() as EventEmitter & { stderr: EventEmitter; close: ReturnType<typeof vi.fn> };
  ch.stderr = new EventEmitter();
  ch.close = vi.fn();
  return ch;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runExec', () => {
  it('stdout 超过上限时保留末尾并标记截断', async () => {
    const ch = fakeChannel();
    const data = Buffer.from('a'.repeat(200) + 'b'.repeat(100));
    const p = runExec(async () => ch as unknown as ChannelLike, 'cmd', { localTimeoutMs: 5000, outputCap: 100 });
    await Promise.resolve();
    ch.emit('data', data);
    ch.emit('exit', 0);
    ch.emit('close');
    const r = await p;
    expect(r.truncated).toBe(true);
    expect(r.stdout.endsWith('b'.repeat(100))).toBe(true);
    expect(r.stdout).not.toContain('a'.repeat(101));
  });

  it('分别收集 stdout 与 stderr，返回退出码', async () => {
    const ch = fakeChannel();
    const p = runExec(async () => ch as unknown as ChannelLike, 'cmd', { localTimeoutMs: 5000, outputCap: 1000 });
    await Promise.resolve();
    ch.emit('data', Buffer.from('out'));
    ch.stderr.emit('data', Buffer.from('err'));
    ch.emit('exit', 2);
    ch.emit('close');
    const r = await p;
    expect(r).toMatchObject({ stdout: 'out', stderr: 'err', exitCode: 2, timedOut: false, truncated: false });
  });

  it('本地超时后关闭通道并标记超时', async () => {
    vi.useFakeTimers();
    const ch = fakeChannel();
    const p = runExec(async () => ch as unknown as ChannelLike, 'cmd', { localTimeoutMs: 1000, outputCap: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await p;
    expect(r.timedOut).toBe(true);
    expect(ch.close).toHaveBeenCalled();
  });

  it('打开通道失败时抛错', async () => {
    await expect(
      runExec(async () => Promise.reject(new Error('连接失败')), 'cmd', { localTimeoutMs: 1000, outputCap: 10 }),
    ).rejects.toThrow('连接失败');
  });
});
