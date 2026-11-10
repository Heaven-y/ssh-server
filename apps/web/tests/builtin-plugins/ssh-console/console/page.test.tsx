// @vitest-environment jsdom
import { settingsApi } from '../../../../src/features/settings/api';
import { sshApi, sshKeys } from '../../../../src/builtin-plugins/ssh-console/ssh/api';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ManagedServer, SshConsoleOverview, SshConsoleProcesses } from '@agentdeck/shared/ssh';
import { ProductSettingsSchema } from '@agentdeck/shared/settings';
import SshConsolePage from '../../../../src/builtin-plugins/ssh-console/console/SshConsolePage';

const servers: ManagedServer[] = ['my-server', 'other-server'].map((alias) => ({
  alias,
  name: alias,
  hostname: 'example.invalid',
  port: 22,
  username: 'researcher',
  authMode: 'key',
  source: 'managed',
}));
const reading = <T,>(data: T) => ({ data, sampledAt: 1, stale: false, message: null, retryAt: null });
const overview: SshConsoleOverview = {
  serverId: 'my-server',
  remoteDir: '~',
  host: reading({
    hostname: 'node',
    cpuCores: 8,
    system: 'Linux demo',
    uptimeSeconds: 3600,
    cpuPercent: 25,
    load: [1, 2, 3],
    memoryUsed: 100,
    memoryTotal: 1000,
    gpus: [],
    processes: [],
    gpuProcessesAvailable: true,
  }),
  disk: reading([
    { filesystem: '/dev/data', mount: '/data', availableBytes: 500, totalBytes: 1000, usedBytes: 500, usedPercent: 50 },
    { filesystem: '/dev/root', mount: '/', availableBytes: 800, totalBytes: 1000, usedBytes: 200, usedPercent: 20 },
  ]),
};
const processes: SshConsoleProcesses = {
  serverId: 'my-server',
  sampledAt: 1,
  stale: false,
  message: null,
  truncated: false,
  gpuProcessesAvailable: true,
  processes: [
    {
      pid: 12,
      ppid: 1,
      user: 'researcher',
      cpuPercent: 12,
      memoryPercent: 2,
      memoryBytes: 1024,
      threads: 4,
      elapsed: '01:00',
      state: 'R',
      command: 'python train.py --full-command',
    },
  ],
  gpuProcesses: [
    {
      pid: 12,
      gpuUuid: 'gpu-1',
      gpuIndex: 1,
      memoryBytes: 1024,
      user: 'researcher',
      command: 'python train.py --full-command',
    },
  ],
};
let client: QueryClient;
const calls: Array<{ url: string; signal?: AbortSignal | null }> = [];
function page(visible = true, initialServer = 'my-server') {
  return (
    <QueryClientProvider client={client}>
      <SshConsolePage visible={visible} initialServer={initialServer} onManageServers={vi.fn()} />
    </QueryClientProvider>
  );
}
async function tick(ms = 30) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sshKeys.sshHosts, servers);
  vi.spyOn(sshApi, 'listSshHosts').mockResolvedValue(servers);
  vi.spyOn(sshApi, 'sshCredentials').mockResolvedValue({
    connected: true,
    paused: false,
    saved: false,
    savingAvailable: true,
    hasPassword: false,
  });
  vi.spyOn(settingsApi, 'readProductSettings').mockResolvedValue({
    settings: ProductSettingsSchema.parse({}),
    revision: 'missing',
  });
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: input, signal: init?.signal });
      if (input.includes('/overview')) return Response.json(overview);
      if (input.includes('/processes')) return Response.json(processes);
      if (input.includes('/files'))
        return Response.json({
          serverId: 'my-server',
          path: '/demo',
          parentPath: '/',
          truncated: false,
          entries: [{ name: 'readme.txt', path: '/demo/readme.txt', type: 'file', size: 20, modifiedAt: null }],
        });
      if (input.includes('/preview'))
        return Response.json({
          serverId: 'my-server',
          path: '/demo/readme.txt',
          text: '只读预览正文',
          size: 20,
          binary: false,
          truncated: true,
        });
      if (input.endsWith('/terminals')) return Response.json({ terminals: [] });
      throw new Error(`未声明的合成接口：${input}`);
    }),
  );
});

it('项目提供的默认服务器只用于首次打开，之后变化不抢走当前服务器标签', async () => {
  const view = render(page());
  await tick();
  view.rerender(page(true, 'other-server'));
  await tick();
  expect(screen.getByRole('tab', { name: 'my-server' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByRole('tab', { name: 'other-server' })).toBeNull();
  expect(calls.some(({ url }) => url.startsWith('/api/ssh-console/other-server'))).toBe(false);
});
afterEach(async () => {
  cleanup();
  await client.cancelQueries();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('独立服务器页面不用项目身份，只对当前可见概览或进程采样，隐藏后停止读取', async () => {
  const view = render(page());
  await tick();
  expect(screen.getByRole('region', { name: 'SSH Console' })).toBeTruthy();
  expect(calls.some(({ url }) => url.startsWith('/api/ssh-console/my-server/overview'))).toBe(true);
  expect(calls.some(({ url }) => url.includes('/workspaces/'))).toBe(false);
  fireEvent.click(screen.getByRole('tab', { name: '进程' }));
  await tick();
  expect(screen.getAllByText('python train.py --full-command')).toHaveLength(2);
  const overviewCount = calls.filter(({ url }) => url.includes('/overview')).length;
  await tick(5000);
  expect(calls.filter(({ url }) => url.includes('/overview'))).toHaveLength(overviewCount);
  view.rerender(page(false));
  await tick();
  const stopped = calls.length;
  await tick(10000);
  expect(calls).toHaveLength(stopped);
});

it('文件页只读，显示截断预览；切服务器后不把旧文件结果当成当前内容', async () => {
  render(page());
  await tick();
  fireEvent.click(screen.getByRole('tab', { name: '文件' }));
  await tick();
  fireEvent.click(screen.getByRole('button', { name: '预览 readme.txt' }));
  await tick();
  expect(screen.getByText('只读预览正文')).toBeTruthy();
  expect(screen.getByText(/仅显示前/)).toBeTruthy();
  for (const label of ['删除', '上传', '保存', '新建文件'])
    expect(screen.queryByRole('button', { name: label })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '连接其他服务器' }));
  await tick();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '打开 other-server' }));
  await tick();
  expect(within(screen.getByRole('tabpanel')).queryByText('只读预览正文')).toBeNull();
  expect(calls.some(({ url }) => url.startsWith('/api/ssh-console/other-server/overview'))).toBe(true);
});

it('概览逐个挂载显示剩余空间与每核负载，进程分组可独立折叠且显示显存合计', async () => {
  render(page());
  await tick();
  expect(screen.getByText('/data')).toBeTruthy();
  expect(screen.getByText('剩余 500 B')).toBeTruthy();
  expect(screen.getByText(/0.13\/核/)).toBeTruthy();
  expect(screen.getByText(/1 \/ 5 \/ 15 分钟/)).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '进程' }));
  await tick();
  const group = screen.getByRole('button', { name: /GPU 1.*1.0 KiB/ });
  fireEvent.click(group);
  expect(group.getAttribute('aria-expanded')).toBe('false');
  expect(screen.getAllByRole('table')).toHaveLength(1);
  fireEvent.click(group);
  expect(screen.getAllByRole('table')).toHaveLength(2);
});
