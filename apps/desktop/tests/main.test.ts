import { describe, expect, it, vi } from 'vitest';
import { acquireSingleInstance, createShutdown, resolveWindowUrl } from '../src/lifecycle';

// 这里只测启动编排，不真的开窗口：CI 没有显示器，Electron 的窗口生命周期靠手工验收。

describe('resolveWindowUrl', () => {
  it('有渲染器地址时加载渲染器', () => {
    expect(resolveWindowUrl('http://127.0.0.1:5000/', 'http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
  });

  it('没有渲染器地址时加载主进程拉起的本机服务', () => {
    expect(resolveWindowUrl('http://127.0.0.1:5000/')).toBe('http://127.0.0.1:5000/');
  });

  it('空白渲染器地址按未设置处理', () => {
    expect(resolveWindowUrl('http://127.0.0.1:5000/', '   ')).toBe('http://127.0.0.1:5000/');
  });
});

describe('acquireSingleInstance', () => {
  it('拿到锁时继续启动，不退出', () => {
    const quit = vi.fn();
    expect(acquireSingleInstance({ requestLock: () => true, quit })).toBe(true);
    expect(quit).not.toHaveBeenCalled();
  });

  it('拿不到锁时退出本次启动，交给已有实例', () => {
    const quit = vi.fn();
    expect(acquireSingleInstance({ requestLock: () => false, quit })).toBe(false);
    expect(quit).toHaveBeenCalledTimes(1);
  });
});

describe('createShutdown', () => {
  it('关窗时先关闭后端再退出应用', async () => {
    const order: string[] = [];
    let release = () => {};
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          order.push('close');
          release = resolve;
        }),
    );
    const quit = vi.fn(() => order.push('quit'));
    const exiting = createShutdown({ close, quit }).exitAfterClose();
    await Promise.resolve();
    expect(quit).not.toHaveBeenCalled();
    release();
    await exiting;
    expect(order).toEqual(['close', 'quit']);
  });

  it('重复触发只释放一次后端', async () => {
    const close = vi.fn(async () => {});
    const shutdown = createShutdown({ close, quit: vi.fn() });
    await Promise.all([shutdown.exitAfterClose(), shutdown.exitAfterClose()]);
    await shutdown.exitAfterClose();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('后端释放失败也退出，不把窗口留在后台', async () => {
    const quit = vi.fn();
    const shutdown = createShutdown({
      close: async () => {
        throw new Error('关闭失败');
      },
      quit,
    });
    await shutdown.exitAfterClose();
    expect(quit).toHaveBeenCalledTimes(1);
    expect(shutdown.closed).toBe(true);
  });

  it('后端未释放前拦住默认退出，释放后放行', async () => {
    const shutdown = createShutdown({ close: async () => {}, quit: vi.fn() });
    expect(shutdown.preventQuitUntilClosed()).toBe(true);
    await shutdown.exitAfterClose();
    expect(shutdown.closed).toBe(true);
    expect(shutdown.preventQuitUntilClosed()).toBe(false);
  });
});
