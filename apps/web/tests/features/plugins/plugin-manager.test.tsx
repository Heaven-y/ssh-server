// @vitest-environment jsdom
import { terminalApi } from '../../../src/builtin-plugins/ssh-console/legacy/terminal/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PluginManager from '../../../src/features/plugins/PluginManager';
import { pluginApi } from '../../../src/features/plugins/plugin-api';
import type { WorkbenchPlugin } from '@agentdeck/shared/plugins';

import {
  closeTerminalTab,
  ensureInitialTerminal,
  openTerminalTab,
  useTerminalStore,
} from '../../../src/builtin-plugins/ssh-console/legacy/terminal/terminal-store';

beforeEach(() => {
  useTerminalStore.setState(useTerminalStore.getInitialState(), true);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  for (const tab of useTerminalStore.getState().tabs) closeTerminalTab(tab.id);
  vi.restoreAllMocks();
});
it('安装副本保持停用，启用需明确确认且刷新真实查询缓存', async () => {
  const plugin: WorkbenchPlugin = {
    builtin: false,
    enabled: false,
    manifest: {
      id: 'fixture',
      name: '示例插件',
      version: '1.0.0',
      apiVersion: 1,
      entry: 'index.html',
      permissions: ['storage'],
      commands: [],
    },
  };
  vi.spyOn(pluginApi, 'list').mockResolvedValue({ plugins: [], revision: 'missing' });
  vi.spyOn(pluginApi, 'install').mockResolvedValue({ plugins: [plugin], revision: 'installed' });
  const toggle = vi
    .spyOn(pluginApi, 'setEnabled')
    .mockResolvedValue({ plugins: [{ ...plugin, enabled: true }], revision: 'enabled' });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PluginManager onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('本地插件目录'), { target: { value: 'fixtures/plugin' } });
  fireEvent.click(screen.getByRole('button', { name: '安装本地插件' }));
  await screen.findByText('1.0.0 · 已停用');
  expect(toggle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '启用 示例插件' }));
  expect(toggle).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: '启用 示例插件' }));
  await waitFor(() => expect(toggle).toHaveBeenCalledExactlyOnceWith('fixture', true, 'installed'));
  expect(await screen.findByText('1.0.0 · 已启用')).toBeTruthy();
  client.clear();
});

it('停用SSH Console确认后清旧终端和待绑定操作，再启用不从旧标签新开shell', async () => {
  const plugin: WorkbenchPlugin = {
    builtin: true,
    enabled: true,
    manifest: {
      id: 'ssh-console',
      name: 'SSH Console',
      version: '1.0.0',
      apiVersion: 1,
      entry: 'index.html',
      permissions: [],
      commands: [],
    },
  };
  vi.spyOn(pluginApi, 'list').mockResolvedValue({ plugins: [plugin], revision: 'enabled' });
  const toggle = vi.spyOn(pluginApi, 'setEnabled').mockResolvedValue({
    plugins: [{ ...plugin, enabled: false }],
    revision: 'disabled',
  });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const workspace = {
    id: 'project',
    name: '演示项目',
    dir: 'project',
    server: 'my-server',
    remoteDir: '~/projects/demo',
  };
  const target = { workspaceId: workspace.id, sshHost: workspace.server, remoteDir: workspace.remoteDir };
  useTerminalStore.setState({
    initialized: true,
    activeTabId: 'old-tab',
    tabs: [
      {
        id: 'old-tab',
        name: '旧终端',
        target,
        busy: false,
        panes: [{ id: 'old-pane', target, binding: 'old-binding', status: { phase: 'ready', message: '已连接' } }],
      },
    ],
  });
  let bindingSignal: AbortSignal | undefined;
  let rejectBinding!: (error: Error) => void;
  const bind = vi.spyOn(terminalApi, 'bindTerminalTarget').mockImplementation((_target, options) => {
    bindingSignal = options?.signal;
    return new Promise((_resolve, reject) => {
      rejectBinding = reject;
    });
  });
  const pending = openTerminalTab(workspace);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PluginManager onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  const disable = await screen.findByRole('button', { name: '停用 SSH Console' });
  fireEvent.click(disable);
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('包括项目服务器工具中的终端'));
  expect(toggle).not.toHaveBeenCalled();
  expect(useTerminalStore.getState().tabs).toHaveLength(2);
  expect(bindingSignal?.aborted).toBe(false);
  confirm.mockReturnValue(true);
  fireEvent.click(disable);
  await waitFor(() => expect(toggle).toHaveBeenCalledExactlyOnceWith('ssh-console', false, 'enabled'));
  const enable = await screen.findByRole('button', { name: '启用 SSH Console' });
  expect(useTerminalStore.getState().tabs).toHaveLength(0);
  expect(bindingSignal?.aborted).toBe(true);
  rejectBinding(new Error('已取消绑定'));
  await pending;
  toggle.mockResolvedValue({ plugins: [plugin], revision: 'enabled-again' });
  fireEvent.click(enable);
  await screen.findByRole('button', { name: '停用 SSH Console' });
  ensureInitialTerminal(workspace);
  expect(useTerminalStore.getState().tabs).toHaveLength(0);
  expect(bind).toHaveBeenCalledOnce();
  client.clear();
});
