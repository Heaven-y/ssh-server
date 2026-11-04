// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { api, queryKeys } from '../../src/lib/api';
import { useChat } from '../../src/features/chat/chat-store';
import { useUiPreferences } from '../../src/ui/ui-preferences';
import { credentials, server, settings, snapshot, workspace } from '../features/resources/fixtures';

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
  wide = true;
  resized = new Set();
  Socket.instances.length = 0;
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === '(min-width: 1280px)' && wide;
    },
    addEventListener: (_event: string, callback: () => void) => {
      if (query === '(min-width: 1280px)') resized.add(callback);
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
  // 右侧面板的展开状态是持久偏好：每个用例从「还没表过态」开始，才按窗口宽度决定首屏。
  useUiPreferences.setState({ sidebarCollapsed: false, dockCollapsed: null });
  vi.spyOn(api, 'listWorkspaces').mockResolvedValue([workspace, other]);
  vi.spyOn(api, 'readProductSettings').mockResolvedValue(settings);
  vi.spyOn(api, 'readEnvironment').mockResolvedValue({ checkedAt: 1, tools: [] });
  vi.spyOn(api, 'listSshHosts').mockResolvedValue([server]);
  vi.spyOn(api, 'sshCredentials').mockResolvedValue(credentials);
  vi.spyOn(api, 'listSessions').mockResolvedValue([]);
  vi.spyOn(api, 'agentCapabilities').mockResolvedValue({ agent: 'claude', entries: [], models: [], warnings: [] });
  vi.spyOn(api, 'readResources').mockImplementation(async () => snapshot());
  vi.spyOn(api, 'readSlurm').mockResolvedValue({ sampledAt: 1, status: 'available', output: '', truncated: false });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ message: '受控未启用接口' }), { status: 503 })),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.sshHosts, [server]);
  client.setQueryData(queryKeys.sshCredentials(server.alias), credentials);
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
function top() {
  return within(screen.getByRole('button', { name: '搜索与操作' }).closest('header')!);
}
function dock() {
  return screen.getByRole('complementary', { name: '服务器面板' });
}

it('服务器面板独立开关，收起后再打开仍是原节点', async () => {
  mount();
  const panel = await screen.findByRole('complementary', { name: '服务器面板' });
  const trigger = top().getByRole('button', { name: '终端' });
  await within(panel).findByRole('region', { name: '服务器资源' });
  await waitFor(() => expect(api.readResources).toHaveBeenCalled());
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(within(panel).getByRole('button', { name: '收起服务器面板' }));
  expect(document.getElementById('server-dock')!.closest('[hidden]')).not.toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByRole('complementary', { name: '服务器面板' })).toBe(panel);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
});

it('顶栏不再提供资源与文件入口，也没有本地文件面板', async () => {
  mount();
  await screen.findByText('选择一条会话查看历史');
  expect(top().queryByRole('button', { name: '资源' })).toBeNull();
  expect(top().queryByRole('button', { name: '文件' })).toBeNull();
  expect(screen.queryByRole('complementary', { name: '文件面板' })).toBeNull();
});

it('窄窗首屏不展开服务器面板，点终端按钮后才出现', async () => {
  wide = false;
  mount();
  await screen.findByText('选择一条会话查看历史');
  expect(screen.queryByRole('complementary', { name: '服务器面板' })).toBeNull();
  fireEvent.click(top().getByRole('button', { name: '终端' }));
  const panel = await screen.findByRole('complementary', { name: '服务器面板' });
  expect(within(panel).getByRole('tab', { name: '终端' }).getAttribute('aria-selected')).toBe('true');
});

it('窄窗主动展开左栏时服务器面板让位，折叠左栏后按记忆恢复', async () => {
  wide = false;
  mount();
  await screen.findByText('选择一条会话查看历史');
  fireEvent.click(top().getByRole('button', { name: '终端' }));
  const panel = await screen.findByRole('complementary', { name: '服务器面板' });
  expect(panel.closest('[hidden]')).toBeNull();
  fireEvent.click(top().getByRole('button', { name: '展开侧栏' }));
  expect(screen.getByRole('navigation', { name: '项目与会话' })).toBeTruthy();
  expect(document.getElementById('server-dock')!.closest('[hidden]')).not.toBeNull();
  fireEvent.click(top().getByRole('button', { name: '折叠侧栏' }));
  expect(document.getElementById('server-dock')!.closest('[hidden]')).toBeNull();
});

it('Escape 收起整个服务器面板并把焦点还给顶栏入口', async () => {
  mount();
  await screen.findByText('选择一条会话查看历史');
  const trigger = top().getByRole('button', { name: '终端' });
  trigger.focus();
  fireEvent.click(trigger);
  const panel = await screen.findByRole('complementary', { name: '服务器面板' });
  const tab = within(panel).getByRole('tab', { name: '资源' });
  tab.focus();
  fireEvent.keyDown(tab, { key: 'Escape' });
  expect(document.getElementById('server-dock')!.closest('[hidden]')).not.toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('嵌套设置弹窗取消时 Escape 不收起服务器面板', async () => {
  mount();
  await screen.findByText('选择一条会话查看历史');
  const panel = document.getElementById('server-dock')!;
  fireEvent.click(top().getByRole('button', { name: '设置' }));
  const settingsDialog = await screen.findByRole<HTMLDialogElement>('dialog', { name: '产品设置' });
  fireEvent.keyDown(settingsDialog, { key: 'Escape' });
  fireEvent(settingsDialog, new Event('cancel', { cancelable: true }));
  expect(panel.closest('[hidden]')).toBeNull();
  fireEvent.keyDown(within(panel).getByRole('tab', { name: '资源' }), { key: 'Escape' });
  expect(panel.closest('[hidden]')).not.toBeNull();
});

it('切换项目时服务器面板与左栏保持同一节点', async () => {
  const errors = vi.spyOn(console, 'error');
  mount();
  await screen.findByText('选择一条会话查看历史');
  const panel = dock();
  const sidebar = screen.getByRole('navigation', { name: '项目与会话' });
  expect(within(sidebar).getByText(workspace.name)).toBeTruthy();
  act(() => useChat.getState().selectWorkspace(other.id));
  expect(screen.getByRole('complementary', { name: '服务器面板' })).toBe(panel);
  expect(screen.getByRole('navigation', { name: '项目与会话' })).toBe(sidebar);
  expect(errors.mock.calls.flat().filter((value) => typeof value === 'string' && value.includes('same key'))).toEqual(
    [],
  );
});

it('顶栏显示当前项目与 SSH 状态，正常本机连接不常驻，断线仍可见并可重连', async () => {
  mount();
  await screen.findByText('选择一条会话查看历史');
  expect(top().getByText(workspace.name)).toBeTruthy();
  expect(top().getByText(workspace.dir)).toBeTruthy();
  expect(top().getByRole('button', { name: 'SSH 连接详情' })).toBeTruthy();
  expect(screen.queryByText('本机服务已连接')).toBeNull();
  act(() => useChat.setState({ connection: 'closed' }));
  expect(top().getByText('本机服务已断开')).toBeTruthy();
  expect(top().getByRole('button', { name: '重新连接网页 WebSocket' })).toBeTruthy();
});
