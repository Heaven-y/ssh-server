import { afterEach, describe, expect, it, vi } from 'vitest';
import { remoteOperation } from '../../src/remote-files/operation';

afterEach(() => vi.useRealTimers());

describe('远端浏览操作截止时间', () => {
  it('配置或排队 Promise 不返回时，也在总截止时间结束请求', async () => {
    vi.useFakeTimers();
    let stopped: AbortSignal | undefined;
    const result = remoteOperation(undefined, (signal) => {
      stopped = signal;
      return new Promise<never>(() => undefined);
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ code: 'timeout' });
    expect(stopped?.aborted).toBe(true);
  });

  it('排队前已取消的请求不再开始读取', async () => {
    const controller = new AbortController();
    controller.abort();
    const start = vi.fn(async () => 'unexpected');
    await expect(remoteOperation(controller.signal, start)).rejects.toMatchObject({ code: 'cancelled' });
    expect(start).not.toHaveBeenCalled();
  });
});
