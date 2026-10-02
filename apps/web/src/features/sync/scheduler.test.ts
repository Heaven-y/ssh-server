import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleVisibleSync } from './scheduler';

afterEach(() => vi.useRealTimers());
function fixture() {
  const events = new EventTarget();
  const page = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  return {
    page,
    change: (visibility: DocumentVisibilityState) => {
      page.visibilityState = visibility;
      events.dispatchEvent(new Event('visibilitychange'));
    },
  };
}
describe('可见页面同步调度', () => {
  it('隐藏页面停止，恢复可见才继续；销毁后无请求', async () => {
    vi.useFakeTimers();
    const { page, change } = fixture();
    const sync = vi.fn(async () => undefined);
    const stop = scheduleVisibleSync({ page, sync, shouldSync: () => true });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(sync).toHaveBeenCalledTimes(2);
    change('hidden');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(2);
    change('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(3);
    stop();
    change('hidden');
    change('visible');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(3);
  });
  it('慢请求不重叠，确认与失败状态不传输', async () => {
    vi.useFakeTimers();
    const { page } = fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sync = vi.fn(() => pending);
    let ready = true;
    const stop = scheduleVisibleSync({ page, sync, shouldSync: () => ready });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(1);
    ready = false;
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(1);
    ready = true;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(sync).toHaveBeenCalledTimes(2);
    stop();
  });
});
