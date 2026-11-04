// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PluginManager from '../../../src/features/plugins/PluginManager';
import { pluginApi } from '../../../src/features/plugins/plugin-api';
import type { WorkbenchPlugin } from '@agentdeck/shared';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('安装副本保持停用，启用需明确确认且刷新真实查询缓存', async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
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
