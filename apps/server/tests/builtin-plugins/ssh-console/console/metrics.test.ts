import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ClientChannel } from 'ssh2';
import { createSshConsoleService } from '../../../../src/builtin-plugins/ssh-console/console/service';
import { consoleFixture } from './console.fixture';
import { resourceFixtureOutput } from '../../../../../../scripts/dev/resource-fixture';

afterEach(() => vi.useRealTimers());

it('概览请求驱动采样且按服务器隔离CPU基线，同一轮并发请求复用缓存', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(10000);
  const f = consoleFixture();
  const ticks = new Map<string, number>();
  f.setExecOutput((alias, command) => {
    if (!command.includes('/proc/stat')) return '/dev/demo 10000 4000 6000 40% /home/demo';
    const tick = (ticks.get(alias) ?? 0) + 1;
    ticks.set(alias, tick);
    return resourceFixtureOutput(tick);
  });
  const service = createSshConsoleService(f);
  try {
    const [first, duplicate] = await Promise.all([service.overview('my-server'), service.overview('my-server')]);
    expect(first.host.data?.cpuPercent).toBeNull();
    expect(first.host.sampledAt).toBe(duplicate.host.sampledAt);
    expect(f.commands).toHaveLength(2);
    vi.setSystemTime(12001);
    const next = await service.overview('my-server');
    expect(next.host.data?.cpuPercent).toBeGreaterThanOrEqual(0);
    expect((await service.overview('other-server')).host.data?.cpuPercent).toBeNull();
    f.invalidate('my-server');
    expect((await service.overview('my-server')).host.data?.cpuPercent).toBeNull();
    expect(f.pool.disconnect).not.toHaveBeenCalled();
  } finally {
    service.dispose();
  }
});

it('无效进程采样显示不可用，插件停用后不继续发远端请求', async () => {
  const f = consoleFixture();
  f.setExecOutput(() => '输出缺少结束标记');
  const service = createSshConsoleService(f);
  try {
    expect(await service.processes('my-server')).toMatchObject({
      stale: true,
      sampledAt: null,
      processes: [],
      gpuProcessesAvailable: false,
    });
    expect(f.commands).toHaveLength(1);
    f.disable();
    service.dispose();
    await expect(service.processes('my-server')).rejects.toMatchObject({ code: 'plugin_disabled' });
    expect(f.commands).toHaveLength(1);
  } finally {
    service.dispose();
  }
});

it('采样通道报错后仍释放通道，不让失败请求留下后台资源', async () => {
  const f = consoleFixture();
  const channel = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), close: vi.fn() });
  vi.mocked(f.pool.openExec).mockImplementation(async () => {
    setImmediate(() => channel.emit('error', new Error('fixture-only')));
    return channel as unknown as ClientChannel;
  });
  const service = createSshConsoleService(f);
  try {
    expect((await service.processes('my-server')).stale).toBe(true);
    expect(channel.close).toHaveBeenCalledOnce();
  } finally {
    service.dispose();
  }
});
