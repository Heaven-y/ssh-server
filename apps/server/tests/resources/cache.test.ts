import { afterEach, expect, it, vi } from 'vitest';
import { ResourceCache } from '../../src/resources/cache';
import { RESOURCE_LIMITS } from '@ssh-server/shared';
import { resourceTiming } from '@ssh-server/shared';

afterEach(() => vi.useRealTimers());
it('动态缩短成功间隔立即生效，参数变化不拆key或重叠首次采样', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const cache = new ResourceCache<number>(1);
  const slow = resourceTiming({ intervalSeconds: 60, timeoutSeconds: 8 });
  const fast = resourceTiming({ intervalSeconds: 2, timeoutSeconds: 3 });
  const load = vi.fn(async (previous: number | null) => (previous ?? 0) + 1);
  try {
    expect((await cache.get('node', load, slow)).data).toBe(1);
    await vi.advanceTimersByTimeAsync(2100);
    expect((await cache.get('node', load, slow)).data).toBe(1);
    const reads = await Promise.all([cache.get('node', load, fast), cache.get('node', load, slow)]);
    expect(reads.map((reading) => reading.data)).toEqual([2, 2]);
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    cache.dispose();
  }
});
it('并发singleflight、成功5秒缓存及容量忙时拒绝；空闲后重新采样', async () => {
  vi.useFakeTimers();
  const cache = new ResourceCache<number>(1);
  let finish!: (value: number) => void;
  const load = vi.fn(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  try {
    const reads = [cache.get('node', load), cache.get('node', load)];
    expect(load).toHaveBeenCalledTimes(1);
    await expect(cache.get('other', load)).rejects.toThrow('资源采样名额已满');
    finish(42);
    const result = await Promise.all(reads);
    expect(result[0]).toEqual(result[1]);
    expect((await cache.get('node', load)).data).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RESOURCE_LIMITS.idleMs);
    const previous = vi.fn(async (value) => {
      expect(value).toBeNull();
      return 7;
    });
    expect((await cache.get('node', previous)).data).toBe(7);
    expect((await cache.get('other', async () => 9)).data).toBe(9);
  } finally {
    cache.dispose();
  }
});

it('失败保留最近数据并按5/10/20/30秒退避，恢复清除错误', async () => {
  vi.useFakeTimers();
  const cache = new ResourceCache<number>(1);
  try {
    const initial = await cache.get('node', async () => 42);
    vi.advanceTimersByTime(5000);
    const fail = vi.fn(async () => {
      throw new Error('private details');
    });
    for (const delay of [5000, 10000, 20000, 30000]) {
      const failed = await cache.get('node', fail);
      expect(failed).toMatchObject({ data: 42, sampledAt: initial.sampledAt, stale: true });
      expect(failed.message).not.toContain('private details');
      expect(failed.retryAt! - Date.now()).toBe(delay);
      await cache.get('node', fail);
      vi.advanceTimersByTime(delay);
    }
    expect(fail).toHaveBeenCalledTimes(4);
    expect(await cache.get('node', async () => 7)).toMatchObject({
      data: 7,
      message: null,
      retryAt: null,
      stale: false,
    });
  } finally {
    cache.dispose();
  }
});

it('dispose取消正在采样且迟到结果不再可读', async () => {
  const cache = new ResourceCache<number>(1);
  let captured!: AbortSignal;
  const read = cache.get('node', async (_previous, signal) => {
    captured = signal;
    await new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(new Error('采样取消')), { once: true }),
    );
    return 1;
  });
  const rejected = expect(read).rejects.toThrow('资源采样服务已关闭');
  cache.dispose();
  expect(captured.aborted).toBe(true);
  await rejected;
  await expect(cache.get('node', async () => 2)).rejects.toThrow('资源采样服务已关闭');
});
