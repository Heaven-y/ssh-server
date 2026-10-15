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
  vi.spyOn(api, 'listFiles').mockResolvedValue({ path: '', entries: [], truncated: false });
  vi.spyOn(api, 'readFile').mockResolvedValue({ path: 'main.py', content: 'print(1)', size: 8 });
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
function resize(value: boolean) {
  act(() => {
    wide = value;
    vi.stubGlobal('innerWidth', value ? 1440 : 960);
    window.dispatchEvent(new Event('resize'));
    resized.forEach((callback) => callback());
  });
}
it('资源与文件独立打开、同时可见，任一收起不影响另一面板', async () => {
  mount();
  const resources = await screen.findByRole('complementary', { name: '资源面板' });
  const toolbar = top();
  const resourceTrigger = toolbar.getByRole('button', { name: '资源' });
  const fileTrigger = toolbar.getByRole('button', { name: '文件' });
  expect(within(resources).getByRole('region', { name: '服务器资源' })).toBeTruthy();
  await waitFor(() => expect(api.readResources).toHaveBeenCalled());
  const sampling = vi.mocked(api.readResources).mock.calls[0]![1]!;
  fireEvent.click(fileTrigger);
  const files = await screen.findByRole('complementary', { name: '文件面板' });
  await within(files).findByRole('textbox', { name: '相对路径' });
  expect(resources.hidden).toBe(false);
  expect(sampling.aborted).toBe(false);
  expect(toolbar.queryByRole('region', { name: '服务器资源' })).toBeNull();
  expect(resourceTrigger.getAttribute('aria-expanded')).toBe('true');
  expect(fileTrigger.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(within(resources).getByRole('button', { name: '收起资源面板' }));
  expect(resources.hidden).toBe(true);
  expect(files.hidden).toBe(false);
  fireEvent.click(resourceTrigger);
  fireEvent.click(within(files).getByRole('button', { name: '收起文件面板' }));
  expect(files.hidden).toBe(true);
  expect(resources.hidden).toBe(false);
  fireEvent.click(fileTrigger);
  expect(screen.getByRole('complementary', { name: '文件面板' })).toBe(files);
});
it('窄窗初始收起，两个非模态面板可共存，Escape只收起焦点所在面板并返回触发器', async () => {
  wide = false;
  mount();
  await screen.findByText('从一条消息开始');
  expect(screen.queryByRole('complementary', { name: '资源面板' })).toBeNull();
  const trigger = top().getByRole('button', { name: '资源' });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(top().getByRole('button', { name: '文件' }));
  await screen.findByRole('textbox', { name: '相对路径' });
  expect(screen.queryByRole('dialog')).toBeNull();
  const resources = screen.getByRole('complementary', { name: '资源面板' });
  const handle = within(resources).getByRole('button', { name: '收起资源面板' });
  handle.focus();
  fireEvent.keyDown(handle, { key: 'Escape' });
  expect(screen.queryByRole('complementary', { name: '资源面板' })).toBeNull();
  expect(screen.getByRole('complementary', { name: '文件面板' })).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
});
it.each([true, false])('嵌套设置弹窗取消时Escape不隐藏文件面板（宽屏=%s）', async (isWide) => {
  wide = isWide;
  mount();
  await screen.findByText('从一条消息开始');
  const toolbar = within(document.getElementById('workspace-topbar')!);
  fireEvent.click(toolbar.getByRole('button', { name: '文件' }));
  const parent = document.getElementById('workspace-files-panel')!;
  fireEvent.click(toolbar.getByRole('button', { name: '设置' }));
  const settingsDialog = await screen.findByRole<HTMLDialogElement>('dialog', { name: '产品设置' });
  fireEvent.keyDown(settingsDialog, { key: 'Escape' });
  fireEvent(settingsDialog, new Event('cancel', { cancelable: true }));
  expect(parent.hidden).toBe(false);
  fireEvent.keyDown(within(parent).getByRole('button', { name: '收起文件面板' }), { key: 'Escape' });
  expect(parent.hidden).toBe(true);
});
it('只读预览随收起、缩放与换工作区保留内容，关闭不需确认', async () => {
  mount();
  await screen.findByText('从一条消息开始');
  fireEvent.click(top().getByRole('button', { name: '文件' }));
  const path = await screen.findByRole<HTMLInputElement>('textbox', { name: '相对路径' });
  fireEvent.change(path, { target: { value: 'main.py' } });
  fireEvent.click(screen.getByRole('button', { name: '查看' }));
  const textbox = await screen.findByRole('textbox', { name: '项目文件内容' });
  expect(screen.getByText(/只读 · python/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '保存文件' })).toBeNull();
  fireEvent.click(top().getByRole('button', { name: '资源' }));
  expect(screen.getByRole('textbox', { name: '项目文件内容' })).toBe(textbox);
  fireEvent.click(screen.getByRole('button', { name: '收起文件面板' }));
  expect(screen.queryByRole('textbox', { name: '项目文件内容' })).toBeNull();
  act(() => useChat.getState().selectWorkspace(other.id));
  resize(false);
  fireEvent.click(top().getByRole('button', { name: '文件' }));
  expect(screen.getByRole('textbox', { name: '项目文件内容' })).toBeTruthy();
  expect(screen.getByText('工作区：示例项目')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getAllByRole('complementary', { name: '文件面板' })).toHaveLength(1);
  resize(true);
  fireEvent.click(screen.getByRole('button', { name: '关闭文件面板' }));
  expect(window.confirm).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: '项目文件内容' })).toBeNull();
  expect(api.readFile).toHaveBeenCalledWith(workspace.id, 'main.py', expect.any(AbortSignal));
}, 20_000);

it('切换工作区时状态栏组件身份不重复', async () => {
  const errors = vi.spyOn(console, 'error');
  mount();
  await screen.findByText('从一条消息开始');
  act(() => useChat.getState().selectWorkspace(other.id));
  expect(screen.getByRole('button', { name: other.name }).getAttribute('aria-current')).toBe('true');
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
