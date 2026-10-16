// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResourcesPanel } from '../../../src/features/resources/ResourcesPanel';
import { useChat } from '../../../src/features/chat/chat-store';
import { api, ApiError, queryKeys } from '../../../src/lib/api';
import { credentials, server, settings, snapshot, workspace } from './fixtures';

let client: QueryClient;
let visible: 'visible' | 'hidden';
beforeEach(() => {
  vi.useFakeTimers();
  visible = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
  useChat.setState({ connection: 'open' });
  vi.spyOn(api, 'readProductSettings').mockResolvedValue(settings);
  vi.spyOn(api, 'listSshHosts').mockResolvedValue([server]);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'available',
            sampledAt: Date.now(),
            output: '',
            truncated: false,
          }),
        ),
    ),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.sshHosts, [server]);
  client.setQueryData(queryKeys.sshCredentials(server.alias), credentials);
});
afterEach(async () => {
  cleanup();
  await client.cancelQueries();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function tick(ms = 20) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function panel(active = true) {
  return (
    <QueryClientProvider client={client}>
      <ResourcesPanel workspace={workspace} active={active} />
    </QueryClientProvider>
  );
}
it('资源在右栏只保留一个控制器，目标详情可核对且不再显示节点进程', async () => {
  const read = vi.spyOn(api, 'readResources').mockResolvedValue(snapshot());
  render(panel());
  await tick();
  expect(read).toHaveBeenCalledTimes(1);
  const region = within(screen.getByRole('region', { name: '服务器资源' }));
  expect(region.getByText('实验服务器')).toBeTruthy();
  expect(region.getByText('当前 SSH 节点。')).toBeTruthy();
  expect(region.queryByText(/采样不运行模型/)).toBeNull();
  fireEvent.click(region.getByText('目标与采样详情'));
  expect(region.getByText(/researcher@example.invalid:22/)).toBeTruthy();
  expect(region.getByText(/采集主机：node/)).toBeTruthy();
  expect(region.getByText(/已过期 \/ 部分不可用/)).toBeTruthy();
  expect(region.queryByRole('meter', { name: 'CPU利用率' })).toBeNull();
  expect(region.queryByText('节点进程')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  await tick(2000);
  expect(read).toHaveBeenCalledTimes(2);
});
it('隐藏右栏取消在途资源请求，恢复后仅恢复一份轮询', async () => {
  const signals: AbortSignal[] = [];
  const read = vi.spyOn(api, 'readResources').mockImplementation((_target, signal) => {
    signals.push(signal!);
    return new Promise(() => undefined);
  });
  const view = render(panel(false));
  await tick(4000);
  expect(read).not.toHaveBeenCalled();
  view.rerender(panel());
  await tick();
  expect(read).toHaveBeenCalledTimes(1);
  view.rerender(panel(false));
  await tick(4000);
  expect(signals[0]!.aborted).toBe(true);
  expect(read).toHaveBeenCalledTimes(1);
  view.rerender(panel());
  await tick();
  expect(read).toHaveBeenCalledTimes(2);
});
it('页面隐藏与网页断线暂停读取，恢复可见与连接后才检查', async () => {
  const signals: AbortSignal[] = [];
  const read = vi.spyOn(api, 'readResources').mockImplementation((_target, signal) => {
    signals.push(signal!);
    return new Promise(() => undefined);
  });
  render(panel());
  await tick();
  visible = 'hidden';
  fireEvent(document, new Event('visibilitychange'));
  await tick(4000);
  expect(signals[0]!.aborted).toBe(true);
  expect(read).toHaveBeenCalledTimes(1);
  act(() => useChat.setState({ connection: 'closed' }));
  visible = 'visible';
  fireEvent(document, new Event('visibilitychange'));
  await tick(4000);
  expect(read).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/网页断线，已暂停/)).toBeTruthy();
  act(() => useChat.setState({ connection: 'open' }));
  await tick();
  expect(read).toHaveBeenCalledTimes(2);
});
it('设置未就绪不采样；陈旧目标错误停止轮询，不伪造正常指标', async () => {
  vi.spyOn(api, 'readProductSettings').mockRejectedValueOnce(new Error('设置不可用'));
  const read = vi
    .spyOn(api, 'readResources')
    .mockRejectedValue(new ApiError(409, '目标已改变', { code: 'target_changed' }));
  render(panel());
  await tick(4000);
  expect(read).not.toHaveBeenCalled();
  expect(screen.getByText(/产品设置未就绪，已暂停/)).toBeTruthy();
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['product-settings'] });
  });
  await tick();
  expect(read).toHaveBeenCalledTimes(1);
  await tick(6000);
  expect(read).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/目标已改变/)).toBeTruthy();
});
it('GPU优先、真实高利用率不等于故障；零值与未知值明确区分', async () => {
  const data = snapshot();
  data.host.data = {
    ...data.host.data!,
    cpuPercent: 0,
    memoryUsed: 8 * 1024 ** 3,
    memoryTotal: 32 * 1024 ** 3,
    gpus: [
      {
        uuid: 'gpu-0',
        index: 0,
        name: '示例 GPU',
        utilization: 99,
        memoryUsed: 6 * 1024 ** 3,
        memoryTotal: 24 * 1024 ** 3,
        temperature: 48,
        power: 120,
      },
    ],
    processes: [{ pid: 123, command: '不要展示的节点进程', cpuPercent: 0, memoryBytes: 0, gpus: [] }],
  };
  vi.spyOn(api, 'readResources').mockResolvedValue(data);
  render(panel());
  await tick();
  const cpu = screen.getByRole('meter', { name: 'CPU利用率' });
  const gpu = screen.getByRole('meter', { name: 'GPU 0 利用率' });
  expect(cpu.getAttribute('aria-valuenow')).toBe('0');
  expect(gpu.getAttribute('aria-valuenow')).toBe('99');
  expect(gpu.compareDocumentPosition(cpu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText('8.0 GiB / 32.0 GiB')).toBeTruthy();
  expect(screen.queryByText('不要展示的节点进程')).toBeNull();
  expect(screen.queryByText(/GPU.*故障/)).toBeNull();
});
it('已知认证或实际档案变化后不展示旧资源，同名不变状态刷新不制造新查询', async () => {
  const data = snapshot();
  data.host.data!.cpuPercent = 42.5;
  const read = vi.spyOn(api, 'readResources').mockResolvedValue(data);
  render(panel());
  await tick();
  expect(screen.getByRole('meter', { name: 'CPU利用率' }).getAttribute('aria-valuenow')).toBe('42.5');
  act(() => {
    client.setQueryData(queryKeys.sshCredentials(server.alias), { ...credentials });
  });
  await tick();
  expect(read).toHaveBeenCalledTimes(1);
  read.mockImplementation(() => new Promise(() => undefined));
  await act(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.sshCredentials(server.alias), refetchType: 'none' });
  });
  await tick();
  expect(screen.queryByRole('meter', { name: 'CPU利用率' })).toBeNull();
  expect(read).toHaveBeenCalledTimes(2);
});
