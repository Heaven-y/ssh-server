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
async function openDetails(agent: string, title: string) {
  fireEvent.click(screen.getByRole('button', { name: `${agent} 会话“${title}”的更多操作` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '重命名' }));
}
it('会话标题单行截断，列表不把来源或显式模型当作实际模型，不逐条读取历史', () => {
  const read = vi.spyOn(api, 'sessionEvents');
  useChat.getState().setModel('requested-model');
  showList();
  expect(screen.queryByText('模型未报告')).toBeNull();
  expect(screen.getByText(claude.summary).classList.contains('truncate')).toBe(true);
  expect(screen.getByText(claude.summary).classList.contains('line-clamp-2')).toBe(false);
  expect(screen.queryByText('requested-model')).toBeNull();
  expect(read).not.toHaveBeenCalled();
});
it('已加载历史模型保留于所属来源缓存，切换及刷新后仅在管理详情显示', async () => {
  const model = 'claude-sonnet-5-long-native-id';
  vi.spyOn(api, 'sessionEvents').mockResolvedValue({ session: claude, events: [], actualModel: model });
  showList();
  await act(() => useChat.getState().openSession(claude));
  expect(screen.queryByText(model)).toBeNull();
  expect(screen.queryByText('模型未报告')).toBeNull();
  act(() => useChat.getState().newSession('codex'));
  act(() => {
    client.setQueryData(queryKeys.sessions('workspace', 'claude'), [{ ...claude }]);
  });
  expect(screen.queryByText(model)).toBeNull();
  await openDetails('Claude', claude.summary);
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
  act(() => useChat.getState().setDefaults(ProductSettingsSchema.parse({ defaultAgent: 'claude' })));
  await act(async () => {
    resolve({ session: claude, events: [], actualModel: 'stale-model' });
    await old;
  });
  expect(screen.queryByText('模型未报告')).toBeNull();
  expect(screen.queryByText('stale-model')).toBeNull();
  expect(useChat.getState().modelOverrides.codex).toBe('');
  expect(useChat.getState().actualModel).toBeUndefined();
});
it('Codex原生模型不占列表标题行，详情仍区分原生会话模型与执行报告', async () => {
  client.setQueryData(queryKeys.sessions('workspace', 'codex'), [{ ...codex, nativeModel: 'gpt-native-session' }]);
  const read = vi.spyOn(api, 'sessionEvents');
  showList();
  expect(screen.queryByText('gpt-native-session')).toBeNull();
  await openDetails('Codex', codex.summary);
  expect(
    within(screen.getByRole('dialog')).getByText('原生会话模型：gpt-native-session（非逐轮执行报告）'),
  ).toBeTruthy();
  expect(read).not.toHaveBeenCalled();
});
it('历史缓存A后列表刷新B，已打开详情采用B；列表缺失时回退历史而标题行始终无模型标签', async () => {
  vi.spyOn(api, 'sessionEvents').mockResolvedValue({ session: { ...codex, nativeModel: 'model-A' }, events: [] });
  showList();
  await act(() => useChat.getState().openSession(codex));
  expect(screen.queryByText('model-A')).toBeNull();
  await openDetails('Codex', codex.summary);
  expect(within(screen.getByRole('dialog')).getByText('原生会话模型：model-A（非逐轮执行报告）')).toBeTruthy();
  act(() => {
    client.setQueryData(queryKeys.sessions('workspace', 'codex'), [{ ...codex, nativeModel: 'model-B' }]);
  });
  await waitFor(() =>
    expect(within(screen.getByRole('dialog')).getByText('原生会话模型：model-B（非逐轮执行报告）')).toBeTruthy(),
  );
  expect(screen.queryByText('model-B')).toBeNull();
  expect(useChat.getState().actualModel).toBeUndefined();
  act(() => {
    client.setQueryData(queryKeys.sessions('workspace', 'codex'), [codex]);
  });
  await waitFor(() =>
    expect(within(screen.getByRole('dialog')).getByText('原生会话模型：model-A（非逐轮执行报告）')).toBeTruthy(),
  );
  expect(screen.queryByText('model-A')).toBeNull();
});
