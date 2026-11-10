// @vitest-environment jsdom
import { settingsApi } from '../../../src/features/settings/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { EnvironmentReport, EnvironmentSummary } from '../../../src/features/settings/EnvironmentReport';
import { cliInstallationApi } from '../../../src/features/settings/cli-installation-api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('启动摘要与设置共享GET报告，缺失有官方指引，未知版本仍可用；仅手动POST重检', async () => {
  const report = {
    checkedAt: 1,
    tools: [
      { name: 'Claude Code' as const, available: true, version: null, message: null },
      { name: 'Codex' as const, available: true, version: null, message: null },
      { name: 'Antigravity' as const, available: false, version: null, message: '可执行文件 agy 未找到或无法启动' },
    ],
  };
  vi.spyOn(settingsApi, 'readEnvironment').mockResolvedValue(report);
  let installed = false;
  vi.spyOn(cliInstallationApi, 'read').mockImplementation(async (agent) => ({
    agent,
    installed: agent !== 'antigravity' || installed,
    currentVersion: null,
    latestVersion: null,
    source: 'unknown',
    updateAvailable: false,
    canInstall: false,
    canUpdate: false,
    checkedAt: null,
    revision: 'a'.repeat(64),
    phase: 'idle',
    operationId: null,
    message: null,
    guideUrl: agent === 'antigravity' ? 'https://antigravity.google/' : 'https://example.com/',
  }));
  vi.spyOn(settingsApi, 'detectEnvironment').mockResolvedValue({
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
  await screen.findByText(/缺少或不可用：Antigravity/);
  expect(screen.getAllByText('版本未知').length).toBe(2);
  const antigravity = within(screen.getByRole('region', { name: 'Antigravity 安装与更新' }));
  expect(antigravity.getByRole('link', { name: '官方安装指南' }).getAttribute('href')).toContain('antigravity');
  expect(settingsApi.readEnvironment).toHaveBeenCalledTimes(1);
  expect(settingsApi.detectEnvironment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '查看设置' }));
  expect(settings).toHaveBeenCalled();
  installed = true;
  fireEvent.click(screen.getByRole('button', { name: '重新检测' }));
  await waitFor(() => expect(settingsApi.detectEnvironment).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('region', { name: '启动环境摘要' })).toBeNull());
  await waitFor(() => expect(screen.getAllByText('版本未知').length).toBe(3));
  expect(cliInstallationApi.read).toHaveBeenCalledTimes(6);
  expect(screen.getByText(/检测时间/)).toBeTruthy();
  client.clear();
});

it('读取中保留简短状态，全部工具可用后不渲染摘要或占位条', async () => {
  let resolve!: (report: Awaited<ReturnType<typeof settingsApi.readEnvironment>>) => void;
  const read = vi.spyOn(settingsApi, 'readEnvironment').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const detect = vi.spyOn(settingsApi, 'detectEnvironment');
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
      tools: (['Claude Code', 'Codex', 'Antigravity'] as const).map((name) => ({
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
  vi.spyOn(settingsApi, 'readEnvironment').mockRejectedValue(new Error('读取失败'));
  const detect = vi.spyOn(settingsApi, 'detectEnvironment');
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

it('版本已最新但运行探测失败时，同一卡片保留不可用原因', async () => {
  vi.spyOn(settingsApi, 'readEnvironment').mockResolvedValue({
    checkedAt: 1,
    tools: [
      { name: 'Codex', available: false, version: '1.0.0', message: 'Codex 未提供工作台所需的 app-server 能力。' },
    ],
  });
  vi.spyOn(cliInstallationApi, 'read').mockImplementation(async (agent) => ({
    agent,
    installed: true,
    currentVersion: '1.0.0',
    latestVersion: '1.0.0',
    source: 'npm',
    updateAvailable: false,
    canInstall: false,
    canUpdate: false,
    checkedAt: 1,
    revision: 'a'.repeat(64),
    phase: 'idle',
    operationId: null,
    message: null,
    guideUrl: 'https://example.com/',
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EnvironmentReport disabled={false} />
    </QueryClientProvider>,
  );
  const codex = within(await screen.findByRole('region', { name: 'Codex 安装与更新' }));
  await codex.findByText('Codex 未提供工作台所需的 app-server 能力。');
  expect(codex.getByText('不可用')).toBeTruthy();
  expect(codex.queryByText('已是最新版本')).toBeNull();
  expect(codex.getByRole('link', { name: '官方安装指南' })).toBeTruthy();
  expect(screen.getAllByRole('region', { name: /安装与更新/ })).toHaveLength(3);
  client.clear();
});
