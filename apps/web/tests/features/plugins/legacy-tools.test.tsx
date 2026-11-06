// @vitest-environment jsdom
import { sshApi } from '../../../src/builtin-plugins/ssh-console/ssh/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkbenchPlugin } from '@agentdeck/shared/plugins';
import { PluginWorkspace } from '../../../src/features/plugins/PluginWorkspace';

// 本用例没有服务器目标；截断未使用的业务依赖，保留页面、入口、返回按钮和 Esc 的真实 DOM。
vi.mock('../../../src/builtin-plugins/ssh-console/console/ConsoleServerPanel', () => ({
  ConsoleServerPanel: () => null,
}));
vi.mock('../../../src/builtin-plugins/ssh-console/console/ConsoleTabs', () => ({ ConsoleServerTabs: () => null }));
vi.mock('../../../src/builtin-plugins/ssh-console/legacy/resources/ResourcesPanel', () => ({
  ResourcesPanel: () => null,
}));
vi.mock('../../../src/builtin-plugins/ssh-console/legacy/remote-files/RemoteFilesPanel', () => ({
  RemoteFilesPanel: () => null,
}));

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

function Fixture() {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setVisible(false)}>
        工作区导航
      </button>
      <PluginWorkspace
        plugin={visible ? plugin : undefined}
        builtinPlugins={[plugin]}
        close={() => setVisible(false)}
      />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('项目服务器工具打开与关闭都有焦点目标，隐藏整个插件不抢左栏焦点', async () => {
  vi.spyOn(sshApi, 'listSshHosts').mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Fixture />
    </QueryClientProvider>,
  );
  const entry = await screen.findByRole('button', { name: '项目服务器工具' });
  expect(screen.getAllByRole('heading', { name: 'SSH Console' })).toHaveLength(1);
  entry.focus();
  fireEvent.click(entry);
  const back = await screen.findByRole('button', { name: '返回 SSH Console' });
  expect(document.activeElement).toBe(back);
  fireEvent.click(back);
  expect(document.activeElement).toBe(entry);

  fireEvent.click(entry);
  const tools = screen.getByRole('region', { name: '项目服务器工具' });
  const hide = within(tools).getByRole('button', { name: '收起服务器面板' });
  hide.focus();
  fireEvent.keyDown(hide, { key: 'Escape' });
  expect(document.activeElement).toBe(entry);

  fireEvent.click(entry);
  const navigation = screen.getByRole('button', { name: '工作区导航' });
  navigation.focus();
  fireEvent.click(navigation);
  expect(document.activeElement).toBe(navigation);
  expect(screen.queryByRole('region', { name: '项目服务器工具' })).toBeNull();
  await client.cancelQueries();
  client.clear();
});
