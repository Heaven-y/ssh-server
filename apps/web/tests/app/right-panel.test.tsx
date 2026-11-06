// @vitest-environment jsdom
import { settingsApi } from '../../src/features/settings/api';
import { chatApi } from '../../src/features/chat/api';
import { projectsApi } from '../../src/features/projects/api';
import { sessionsApi } from '../../src/features/sessions/api';
import { sshApi, sshKeys } from '../../src/builtin-plugins/ssh-console/ssh/api';
import { resourcesApi } from '../../src/builtin-plugins/ssh-console/legacy/resources/api';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pluginApi } from '../../src/features/plugins/plugin-api';
import { App } from '../../src/app/App';

import { useChat } from '../../src/features/chat/chat-store';
import { useUiPreferences } from '../../src/ui/ui-preferences';
import {
  credentials,
  server,
  settings,
  snapshot,
  workspace,
} from '../builtin-plugins/ssh-console/legacy/resources/fixtures';

let client: QueryClient;
let wide: boolean;
let resized: Set<() => void>;
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onmessage?: (event: MessageEvent<string>) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(readonly url: URL) {
    Socket.instances.push(this);
    queueMicrotask(() => this.onmessage?.({ data: '{"type":"ready"}' } as MessageEvent<string>));
  }
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
const other = { ...workspace, id: 'w2', name: '另一个项目', remoteDir: '~/projects/other' };
beforeEach(() => {
  useChat.setState(useChat.getInitialState(), true);
  wide = true;
  resized = new Set();
  Socket.instances.length = 0;
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('matchMedia', (_query: string) => ({
    get matches() {
      return wide;
    },
    addEventListener: (_event: string, callback: () => void) => {
      resized.add(callback);
    },
    removeEventListener: (_event: string, callback: () => void) => resized.delete(callback),
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
  HTMLDialogElement.prototype.show = HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  useChat.setState({
    workspaceId: workspace.id,
    sessionId: undefined,
    running: false,
    loadingHistory: false,
    items: [],
    connection: 'open',
    agent: 'claude',
  });
  // 每次挂载右栏均关闭；旧服务器栏偏好不再决定对话布局。
  useUiPreferences.setState({ sidebarCollapsed: false, dockCollapsed: null });
  vi.spyOn(projectsApi, 'listWorkspaces').mockResolvedValue([workspace, other]);
  vi.spyOn(settingsApi, 'readProductSettings').mockResolvedValue(settings);
  vi.spyOn(settingsApi, 'readEnvironment').mockResolvedValue({ checkedAt: 1, tools: [] });
  vi.spyOn(sshApi, 'listSshHosts').mockResolvedValue([server]);
  vi.spyOn(sshApi, 'sshCredentials').mockResolvedValue(credentials);
  vi.spyOn(sessionsApi, 'listSessions').mockResolvedValue([]);
  vi.spyOn(pluginApi, 'list').mockResolvedValue({
    revision: 'fixture',
    plugins: [
      {
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
      },
    ],
  });
  vi.spyOn(chatApi, 'agentCapabilities').mockResolvedValue({ agent: 'claude', entries: [], models: [], warnings: [] });
  vi.spyOn(resourcesApi, 'readResources').mockImplementation(async () => snapshot());
  vi.spyOn(resourcesApi, 'readSlurm').mockResolvedValue({
    sampledAt: 1,
    status: 'available',
    output: '',
    truncated: false,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ message: '受控未启用接口' }), { status: 503 })),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sshKeys.sshHosts, [server]);
  client.setQueryData(sshKeys.sshCredentials(server.alias), credentials);
});
afterEach(async () => {
  cleanup();
  await client.cancelQueries();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});
function mount() {
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

it.each([null, false, true])('默认只显示工作区和对话，旧服务器栏偏好%s不连接服务器', async (oldChoice) => {
  useUiPreferences.setState({ dockCollapsed: oldChoice });
  mount();
  await screen.findByLabelText('输入消息');
  expect(screen.queryByRole('complementary', { name: '右侧边栏' })).toBeNull();
  expect(screen.queryByRole('complementary', { name: '服务器面板' })).toBeNull();
  expect(resourcesApi.readResources).not.toHaveBeenCalled();
  expect(sshApi.sshCredentials).not.toHaveBeenCalled();
  expect(sshApi.listSshHosts).not.toHaveBeenCalled();
});
it('右侧按需打开会话信息，收起重开不卸载输入草稿', async () => {
  mount();
  const composer = await screen.findByLabelText('输入消息');
  fireEvent.change(composer, { target: { value: '保留草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '打开右侧边栏' }));
  const panel = screen.getByRole('complementary', { name: '右侧边栏' });
  expect(within(panel).getByRole('heading', { name: '会话信息' })).toBeTruthy();
  const close = within(panel).getByRole('button', { name: '收起右侧边栏' });
  close.focus();
  fireEvent.keyDown(close, { key: 'Escape' });
  const reopen = screen.getByRole('button', { name: '打开右侧边栏' });
  expect(document.activeElement).toBe(reopen);
  fireEvent.click(reopen);
  expect(screen.getByRole('complementary', { name: '右侧边栏' })).toBe(panel);
  expect(screen.getByLabelText('输入消息')).toBe(composer);
  expect((composer as HTMLTextAreaElement).value).toBe('保留草稿');
  expect(resourcesApi.readResources).not.toHaveBeenCalled();
});
it('SSH Console从左上打开中央面板，返回当前工作区保留对话草稿', async () => {
  mount();
  const composer = await screen.findByLabelText('输入消息');
  fireEvent.change(composer, { target: { value: '留在对话' } });
  fireEvent.click(await screen.findByRole('button', { name: 'SSH Console' }));
  expect(await screen.findByRole('region', { name: 'SSH Console页面' })).toBeTruthy();
  expect(screen.queryByRole('complementary', { name: '服务器面板' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: '输入消息' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + workspace.name) }));
  expect(await screen.findByLabelText('输入消息')).toBe(composer);
  expect((composer as HTMLTextAreaElement).value).toBe('留在对话');
  expect(screen.queryByRole('region', { name: 'SSH Console页面' })).toBeNull();
});
it('窄窗折叠为图标导航，右侧仍只在主动打开后出现', async () => {
  wide = false;
  mount();
  await screen.findByLabelText('输入消息');
  expect(screen.getByRole('navigation', { name: '项目与会话' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '展开侧栏' })).toBeTruthy();
  expect(screen.queryByRole('complementary', { name: '右侧边栏' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '打开右侧边栏' }));
  expect(screen.getByRole('complementary', { name: '右侧边栏' })).toBeTruthy();
});
it('运行中从另一工作区新建不会抢占当前原生回合', async () => {
  mount();
  await screen.findByLabelText('输入消息');
  act(() => useChat.setState({ running: true, pendingClientTurnId: 'pending', agent: 'claude' }));
  const nav = screen.getByRole('navigation', { name: '项目与会话' });
  fireEvent.click(await within(nav).findByRole('button', { name: 'SSH Console' }));
  expect(screen.queryByRole('region', { name: 'SSH Console页面' })).toBeNull();
  expect(screen.getByLabelText('输入消息')).toBeTruthy();
  fireEvent.click(within(nav).getByRole('button', { name: /^另一个项目/ }));
  fireEvent.click(within(nav).getByRole('button', { name: '新建会话' }));
  const entry = await screen.findByRole('menuitem', { name: 'Antigravity' });
  fireEvent.click(entry);
  expect(useChat.getState()).toMatchObject({
    workspaceId: workspace.id,
    agent: 'claude',
    running: true,
    pendingClientTurnId: 'pending',
  });
});
