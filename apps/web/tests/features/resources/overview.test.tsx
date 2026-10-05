// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProductSettingsSchema, type ResourceSnapshot, type Workspace } from '@ssh-server/shared';
import { ResourcesPanel } from '../../../src/features/resources/ResourcesPanel';
import { useChat } from '../../../src/features/chat/chat-store';
import { api, ApiError } from '../../../src/lib/api';

const workspace: Workspace = {
  id: 'w1',
  name: '示例项目',
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
  localDir: 'project',
};
const settings = { settings: ProductSettingsSchema.parse({ resources: { intervalSeconds: 2 } }), revision: 'missing' };
const snapshot = (): ResourceSnapshot => ({
  workspaceId: 'w1',
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
  host: {
    data: {
      hostname: 'node',
      cpuPercent: null,
      memoryUsed: null,
      memoryTotal: null,
      load: null,
      gpus: null,
      processes: null,
      gpuProcessesAvailable: false,
    },
    sampledAt: Date.now(),
    stale: false,
    message: null,
    retryAt: null,
  },
  disk: { data: null, sampledAt: null, stale: true, message: '磁盘不可用', retryAt: null },
});
let client: QueryClient;
let visible: 'visible' | 'hidden';
beforeEach(() => {
  vi.useFakeTimers();
  visible = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
  useChat.setState({ connection: 'open' });
  vi.spyOn(api, 'readProductSettings').mockResolvedValue(settings);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  cleanup();
  await client.cancelQueries();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function tick(ms = 20) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function mount() {
  return render(
    <QueryClientProvider client={client}>
      <ResourcesPanel workspace={workspace} />
    </QueryClientProvider>,
  );
}
it('概览和详情只有一次查询与一个轮询，空值和过期状态可读', async () => {
  const read = vi.spyOn(api, 'readResources').mockResolvedValue(snapshot());
  mount();
  await tick();
  expect(read).toHaveBeenCalledTimes(1);
  expect(screen.getByText('CPU 不可用')).toBeTruthy();
  expect(screen.getByText('GPU 不可用')).toBeTruthy();
  expect(screen.getByText('过期 / 不可用')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '服务器资源详情' }));
  await tick();
  expect(read).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog', { name: '服务器资源' })).toBeTruthy();
  await tick(2000);
  expect(read).toHaveBeenCalledTimes(2);
});
it('隐藏/网页断线取消在途请求并暂停，恢复可见与连接后才检查', async () => {
  const signals: AbortSignal[] = [];
  const read = vi.spyOn(api, 'readResources').mockImplementation((_target, signal) => {
    signals.push(signal!);
    return new Promise(() => undefined);
  });
  mount();
  await tick();
  expect(read).toHaveBeenCalledTimes(1);
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
  expect(screen.getByText('网页断线，已暂停')).toBeTruthy();
  act(() => useChat.setState({ connection: 'open' }));
  await tick();
  expect(read).toHaveBeenCalledTimes(2);
});
it('产品设置读取失败不采样；陈旧目标错误停止轮询，不能伪造正常指标', async () => {
  vi.spyOn(api, 'readProductSettings').mockRejectedValueOnce(new Error('设置不可用'));
  const read = vi
    .spyOn(api, 'readResources')
    .mockRejectedValue(new ApiError(409, '目标已改变', { code: 'target_changed' }));
  mount();
  await tick(4000);
  expect(read).not.toHaveBeenCalled();
  expect(screen.getByText('产品设置未就绪，已暂停')).toBeTruthy();
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['product-settings'] });
  });
  await tick();
  expect(read).toHaveBeenCalledTimes(1);
  await tick(6000);
  expect(read).toHaveBeenCalledTimes(1);
  expect(screen.getByText('过期 / 不可用')).toBeTruthy();
});
