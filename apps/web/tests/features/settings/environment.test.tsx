// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../../src/lib/api';
import { EnvironmentReport, EnvironmentSummary } from '../../../src/features/settings/EnvironmentReport';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('启动摘要与设置共享GET报告，缺失有官方指引，未知版本仍可用；仅手动POST重检', async () => {
  const report = {
    checkedAt: 1,
    tools: [
      { name: 'Node.js' as const, available: true, version: null, message: null },
      { name: 'Claude Code' as const, available: true, version: null, message: null },
      { name: 'Codex' as const, available: false, version: null, message: '未安装' },
    ],
  };
  vi.spyOn(api, 'readEnvironment').mockResolvedValue(report);
  vi.spyOn(api, 'detectEnvironment').mockResolvedValue({
    ...report,
    tools: report.tools.map((tool) => ({ ...tool, available: true })),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const settings = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <EnvironmentSummary onOpenSettings={settings} />
      <EnvironmentReport disabled={false} />
    </QueryClientProvider>,
  );
  await screen.findByText(/缺少或不可用：Codex/);
  expect(screen.getAllByText(/可用 · 版本未知/).length).toBe(2);
  expect(screen.getByRole('link', { name: /Codex 官方/ }).getAttribute('href')).toContain('openai.com');
  expect(api.readEnvironment).toHaveBeenCalledTimes(1);
  expect(api.detectEnvironment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '查看设置' }));
  expect(settings).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新检测' }));
  await waitFor(() => expect(api.detectEnvironment).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('region', { name: '启动环境摘要' })).toBeNull());
  expect(screen.getAllByText(/可用 · 版本未知/).length).toBe(3);
  expect(screen.getByText(/检测时间/)).toBeTruthy();
  client.clear();
});

it('读取中保留简短状态，全部工具可用后不渲染摘要或占位条', async () => {
  let resolve!: (report: Awaited<ReturnType<typeof api.readEnvironment>>) => void;
  const read = vi.spyOn(api, 'readEnvironment').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const detect = vi.spyOn(api, 'detectEnvironment');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <EnvironmentSummary onOpenSettings={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('status').textContent).toMatch(/正在读取.*环境/);
  await act(async () => {
    resolve({
      checkedAt: 1,
      tools: (['Node.js', 'Claude Code', 'Codex', 'git', 'rclone'] as const).map((name) => ({
        name,
        available: true,
        version: '1.0',
        message: null,
      })),
    });
  });
  await waitFor(() => expect(container.childElementCount).toBe(0));
  expect(read).toHaveBeenCalledOnce();
  expect(detect).not.toHaveBeenCalled();
  client.clear();
});

it('读取失败保留设置入口，不自动重新检测', async () => {
  vi.spyOn(api, 'readEnvironment').mockRejectedValue(new Error('读取失败'));
  const detect = vi.spyOn(api, 'detectEnvironment');
  const settings = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EnvironmentSummary onOpenSettings={settings} />
    </QueryClientProvider>,
  );
  await screen.findByText('环境读取失败');
  fireEvent.click(screen.getByRole('button', { name: '查看设置' }));
  expect(settings).toHaveBeenCalledOnce();
  expect(detect).not.toHaveBeenCalled();
  client.clear();
});
