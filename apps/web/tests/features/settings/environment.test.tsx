// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  fireEvent.click(screen.getByRole('button', { name: '查看安装与配置指引' }));
  expect(settings).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新检测' }));
  await waitFor(() => expect(api.detectEnvironment).toHaveBeenCalledTimes(1));
  await screen.findByText(/基础工具均可用/);
  client.clear();
});
