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
  useUiPreferences.setState({ sidebarCollapsed: false });
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

it('资源面板独立开关，收起后再打开仍是原节点', async () => {
  mount();
  const resources = await screen.findByRole('complementary', { name: '资源面板' });
  const toolbar = top();
  const trigger = toolbar.getByRole('button', { name: '资源' });
  expect(within(resources).getByRole('region', { name: '服务器资源' })).toBeTruthy();
  await waitFor(() => expect(api.readResources).toHaveBeenCalled());
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(within(resources).getByRole('button', { name: '收起资源面板' }));
  expect(resources.hidden).toBe(true);
  fireEvent.click(trigger);
  expect(screen.getByRole('complementary', { name: '资源面板' })).toBe(resources);
});

it('本地文件面板随镜像域一起删除，顶栏不再提供文件入口', async () => {
  mount();
  await screen.findByText('从一条消息开始');
  expect(top().queryByRole('button', { name: '文件' })).toBeNull();
  expect(screen.queryByRole('complementary', { name: '文件面板' })).toBeNull();
});

it('窄窗初始收起，Escape只收起焦点所在面板并返回触发器', async () => {
  wide = false;
  mount();
  await screen.findByText('从一条消息开始');
  expect(screen.queryByRole('complementary', { name: '资源面板' })).toBeNull();
  const trigger = top().getByRole('button', { name: '资源' });
  trigger.focus();
  fireEvent.click(trigger);
  const resources = await screen.findByRole('complementary', { name: '资源面板' });
  const handle = within(resources).getByRole('button', { name: '收起资源面板' });
  handle.focus();
  fireEvent.keyDown(handle, { key: 'Escape' });
  expect(screen.queryByRole('complementary', { name: '资源面板' })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('嵌套设置弹窗取消时Escape不收起资源面板', async () => {
  mount();
  await screen.findByText('从一条消息开始');
  const toolbar = top();
  const parent = document.getElementById('workspace-resources-panel')!;
  fireEvent.click(toolbar.getByRole('button', { name: '设置' }));
  const settingsDialog = await screen.findByRole<HTMLDialogElement>('dialog', { name: '产品设置' });
  fireEvent.keyDown(settingsDialog, { key: 'Escape' });
  fireEvent(settingsDialog, new Event('cancel', { cancelable: true }));
  expect(parent.hidden).toBe(false);
  fireEvent.keyDown(within(parent).getByRole('button', { name: '收起资源面板' }), { key: 'Escape' });
  expect(parent.hidden).toBe(true);
});

it('切换工作区时资源面板保持同一节点，项目列表暂为占位', async () => {
  const errors = vi.spyOn(console, 'error');
  mount();
  await screen.findByText('从一条消息开始');
  const resources = screen.getByRole('complementary', { name: '资源面板' });
  expect(screen.getByRole('navigation', { name: '项目列表' }).textContent).toContain('项目列表将在后续任务接入');
  act(() => useChat.getState().selectWorkspace(other.id));
  expect(screen.getByRole('complementary', { name: '资源面板' })).toBe(resources);
  expect(errors.mock.calls.flat().filter((value) => typeof value === 'string' && value.includes('same key'))).toEqual(
    [],
  );
});

it('顶栏显示当前工作区SSH，正常本机连接不常驻，断线仍可见并可重连', async () => {
  mount();
  await screen.findByText('从一条消息开始');
  expect(top().getByRole('button', { name: 'SSH 连接详情' })).toBeTruthy();
  expect(screen.queryByText('本机服务已连接')).toBeNull();
  act(() => useChat.setState({ connection: 'closed' }));
  expect(top().getByText('本机服务已断开')).toBeTruthy();
  expect(top().getByRole('button', { name: '重新连接网页 WebSocket' })).toBeTruthy();
});
