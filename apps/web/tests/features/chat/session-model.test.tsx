// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProductSettingsSchema, type SessionHistory } from '@ssh-server/shared';
import { SessionList } from '../../../src/features/workspaces/SessionList';
import { api, queryKeys } from '../../../src/lib/api';
import { useChat } from '../../../src/features/chat/chat-store';

const claude = { agent: 'claude' as const, sessionId: 'same', summary: '很长的会话标题'.repeat(10), lastModified: 1 };
const codex = { agent: 'codex' as const, sessionId: 'same', summary: '另一来源', lastModified: 2 };
let client: QueryClient;
beforeEach(() => {
  useChat.setState(useChat.getInitialState(), true);
  // jsdom 缺少原生 dialog 方法；保留真实组件，只模拟开关属性。
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  useChat.getState().selectWorkspace('workspace');
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.sessions('workspace', 'claude'), [claude]);
  client.setQueryData(queryKeys.sessions('workspace', 'codex'), [codex]);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});
function showList() {
  render(
    <QueryClientProvider client={client}>
      <SessionList workspaceId="workspace" />
    </QueryClientProvider>,
  );
}
it('会话标题单行截断，列表不把来源、默认或显式模型当作实际模型，不逐条读取历史', () => {
  const read = vi.spyOn(api, 'sessionEvents');
  useChat.getState().setDefaults(ProductSettingsSchema.parse({ defaultModels: { claude: 'default-model' } }));
  useChat.getState().setModel('requested-model');
  showList();
  expect(screen.getAllByText('模型未报告')).toHaveLength(2);
  expect(screen.getByText(claude.summary).classList.contains('truncate')).toBe(true);
  expect(screen.getByText(claude.summary).classList.contains('line-clamp-2')).toBe(false);
  expect(screen.queryByText('requested-model')).toBeNull();
  expect(screen.queryByText('default-model')).toBeNull();
  expect(read).not.toHaveBeenCalled();
});
it('已加载历史模型立即进入所属来源的列表，切换及列表刷新后保留，管理详情可读完整模型', async () => {
  const model = 'claude-sonnet-5-long-native-id';
  vi.spyOn(api, 'sessionEvents').mockResolvedValue({ session: claude, events: [], actualModel: model });
  showList();
  await act(() => useChat.getState().openSession(claude));
  expect(screen.getByText(model)).toBeTruthy();
  expect(screen.getAllByText('模型未报告')).toHaveLength(1);
  act(() => useChat.getState().newSession('codex'));
  act(() => {
    client.setQueryData(queryKeys.sessions('workspace', 'claude'), [{ ...claude }]);
  });
  expect(screen.getByText(model)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: `Claude 会话“${claude.summary}”的更多操作` }));
  expect(within(screen.getByRole('dialog')).getByText(model, { exact: false })).toBeTruthy();
  expect(within(screen.getByRole('dialog')).getByText(/运行来源：Claude/)).toBeTruthy();
});
it('迟到默认不覆盖历史模型，空模型和迟到旧历史不污染另一来源', async () => {
  let resolve!: (history: SessionHistory) => void;
  vi.spyOn(api, 'sessionEvents')
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce({ session: codex, events: [], actualModel: '  ' });
  showList();
  let old!: Promise<void>;
  act(() => {
    old = useChat.getState().openSession(claude);
  });
  await act(() => useChat.getState().openSession(codex));
  act(() =>
    useChat
      .getState()
      .setDefaults(ProductSettingsSchema.parse({ defaultAgent: 'claude', defaultModels: { codex: 'late-default' } })),
  );
  await act(async () => {
    resolve({ session: claude, events: [], actualModel: 'stale-model' });
    await old;
  });
  expect(screen.getAllByText('模型未报告')).toHaveLength(2);
  expect(screen.queryByText('stale-model')).toBeNull();
  expect(useChat.getState().modelOverrides.codex).toBe('');
  expect(useChat.getState().actualModel).toBeUndefined();
});
it('Codex 列表直接显示原生会话模型，同时明确不是逐轮执行报告', () => {
  client.setQueryData(queryKeys.sessions('workspace', 'codex'), [{ ...codex, nativeModel: 'gpt-native-session' }]);
  const read = vi.spyOn(api, 'sessionEvents');
  showList();
  expect(screen.getByText('gpt-native-session').getAttribute('title')).toContain('原生会话模型');
  expect(screen.getByText('gpt-native-session').getAttribute('title')).toContain('非逐轮执行');
  expect(read).not.toHaveBeenCalled();
});
it('历史缓存 A 后列表刷新 B，已打开详情和列表同步采用 B；列表未提供时回退历史', async () => {
  vi.spyOn(api, 'sessionEvents').mockResolvedValue({ session: { ...codex, nativeModel: 'model-A' }, events: [] });
  showList();
  await act(() => useChat.getState().openSession(codex));
  expect(screen.getByText('model-A')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: `Codex 会话“${codex.summary}”的更多操作` }));
  expect(within(screen.getByRole('dialog')).getByText('原生会话模型：model-A（非逐轮执行报告）')).toBeTruthy();
  act(() => {
    client.setQueryData(queryKeys.sessions('workspace', 'codex'), [{ ...codex, nativeModel: 'model-B' }]);
  });
  await waitFor(() => expect(screen.getByText('model-B')).toBeTruthy());
  expect(within(screen.getByRole('dialog')).getByText('原生会话模型：model-B（非逐轮执行报告）')).toBeTruthy();
  expect(useChat.getState().actualModel).toBeUndefined();
  act(() => {
    client.setQueryData(queryKeys.sessions('workspace', 'codex'), [codex]);
  });
  await waitFor(() => expect(screen.getByText('model-A')).toBeTruthy());
  expect(within(screen.getByRole('dialog')).getByText('原生会话模型：model-A（非逐轮执行报告）')).toBeTruthy();
});
