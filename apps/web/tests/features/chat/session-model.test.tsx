// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProductSettingsSchema, type SessionHistory, type SessionSummary } from '@agentdeck/shared';
import { SessionList } from '../../../src/features/workspaces/SessionList';
import { api, queryKeys } from '../../../src/lib/api';
import { useChat } from '../../../src/features/chat/chat-store';

/** 列表行只有项目归属与标题；原生模型等元数据只在历史里出现。 */
const row = (agent: 'claude' | 'codex', sessionId: string, title: string, updatedAt: number): SessionSummary => ({
  agent,
  sessionId,
  projectId: null,
  title,
  updatedAt: new Date(updatedAt).toISOString(),
  running: false,
});
const claude = row('claude', 'same', '很长的会话标题'.repeat(10), 1);
const codex = row('codex', 'same', '另一来源', 2);
/** 历史行是原生身份，保留 summary / lastModified / nativeModel。 */
const record = (source: SessionSummary, nativeModel?: string) => ({
  agent: source.agent,
  sessionId: source.sessionId,
  summary: source.title,
  lastModified: Date.parse(source.updatedAt),
  ...(nativeModel ? { nativeModel } : {}),
});
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
  expect(screen.getByText(claude.title).classList.contains('truncate')).toBe(true);
  expect(screen.getByText(claude.title).classList.contains('line-clamp-2')).toBe(false);
  expect(screen.queryByText('requested-model')).toBeNull();
  expect(read).not.toHaveBeenCalled();
});
it('已加载历史模型保留于所属来源缓存，切换及刷新后仅在管理详情显示', async () => {
  const model = 'claude-sonnet-5-long-native-id';
  vi.spyOn(api, 'sessionEvents').mockResolvedValue({ session: record(claude), events: [], actualModel: model });
  showList();
  await act(() => useChat.getState().openSession(claude));
  expect(screen.queryByText(model)).toBeNull();
  expect(screen.queryByText('模型未报告')).toBeNull();
  act(() => useChat.getState().newSession('codex'));
  act(() => {
    client.setQueryData(queryKeys.sessions('workspace', 'claude'), [{ ...claude }]);
  });
  expect(screen.queryByText(model)).toBeNull();
  await openDetails('Claude', claude.title);
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
    .mockResolvedValueOnce({ session: record(codex), events: [], actualModel: '  ' });
  showList();
  let old!: Promise<void>;
  act(() => {
    old = useChat.getState().openSession(claude);
  });
  await act(() => useChat.getState().openSession(codex));
  act(() => useChat.getState().setDefaults(ProductSettingsSchema.parse({ defaultAgent: 'claude' })));
  await act(async () => {
    resolve({ session: record(claude), events: [], actualModel: 'stale-model' });
    await old;
  });
  expect(screen.queryByText('模型未报告')).toBeNull();
  expect(screen.queryByText('stale-model')).toBeNull();
  expect(useChat.getState().modelOverrides.codex).toBe('');
  expect(useChat.getState().actualModel).toBeUndefined();
});
it('列表行没有原生模型字段，未读历史时详情不显示任何模型结论', async () => {
  const read = vi.spyOn(api, 'sessionEvents');
  showList();
  expect(Object.keys(codex)).not.toContain('nativeModel');
  await openDetails('Codex', codex.title);
  expect(within(screen.getByRole('dialog')).queryByText(/^会话模型：/)).toBeNull();
  expect(within(screen.getByRole('dialog')).queryByText(/^实际模型：/)).toBeNull();
  expect(read).not.toHaveBeenCalled();
});
it('历史是会话模型的唯一来源：刷新列表不改变它，列表缺失时仍显示历史值', async () => {
  vi.spyOn(api, 'sessionEvents').mockResolvedValue({ session: record(codex, 'model-A'), events: [] });
  showList();
  await act(() => useChat.getState().openSession(codex));
  expect(screen.queryByText('model-A')).toBeNull();
  await openDetails('Codex', codex.title);
  expect(within(screen.getByRole('dialog')).getByText('会话模型：model-A')).toBeTruthy();
  act(() => {
    client.setQueryData(queryKeys.sessions('workspace', 'codex'), [{ ...codex, title: '刷新后的标题' }]);
  });
  expect(within(screen.getByRole('dialog')).getByText('会话模型：model-A')).toBeTruthy();
  expect(screen.queryByText('model-A')).toBeNull();
  expect(useChat.getState().actualModel).toBeUndefined();
  act(() => {
    client.setQueryData(queryKeys.sessions('workspace', 'codex'), []);
  });
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('会话模型：model-A')).toBeTruthy());
});
