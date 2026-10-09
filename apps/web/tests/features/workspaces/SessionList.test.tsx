// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, queryKeys } from '../../../src/lib/api';
import { SessionList } from '../../../src/features/workspaces/SessionList';
import { useChat } from '../../../src/features/chat/chat-store';

const session = { agent: 'claude' as const, sessionId: 'native-id', summary: '原生历史仍可打开', lastModified: 1 };
const archived = { agent: 'codex' as const, sessionId: 'archived-id', summary: '归档记录', lastModified: 2 };
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.sessions('workspace', 'claude'), [session]);
  client.setQueryData(queryKeys.sessions('workspace', 'codex'), []);
  client.setQueryData(queryKeys.sessions('workspace', 'codex', true), [archived]);
  useChat.setState(useChat.getInitialState(), true);
  useChat.getState().selectWorkspace('workspace');
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});
function mount() {
  render(
    <QueryClientProvider client={client}>
      <SessionList workspaceId="workspace" />
    </QueryClientProvider>,
  );
}
async function openAction(name: string, agent = 'Claude', title = session.summary) {
  fireEvent.click(screen.getByRole('button', { name: `${agent} 会话“${title}”的更多操作` }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

it('Codex来源失败仍保留Claude历史与独立重试入口', async () => {
  client.removeQueries({ queryKey: queryKeys.sessions('workspace', 'codex') });
  await client
    .fetchQuery({
      queryKey: queryKeys.sessions('workspace', 'codex'),
      queryFn: () => Promise.reject(new Error('运行时不可用')),
    })
    .catch(() => undefined);
  mount();
  expect(screen.getByText(session.summary)).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('运行时不可用');
  expect(screen.getByRole('button', { name: '重新读取 Codex' })).toBeTruthy();
});

it('标题仅选择会话，更多先展示菜单，不直接打开综合管理弹窗', async () => {
  const read = vi.spyOn(api, 'sessionEvents').mockResolvedValue({ session, events: [] });
  mount();
  const title = screen.getByText(session.summary);
  expect(title.closest('button')?.textContent).toBe(session.summary);
  fireEvent.click(title);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /更多操作/ }));
  expect(await screen.findByRole('menu')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('menuitem', { name: '重命名' })).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: '删除' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: '归档' })).toBeNull();
});

it('重命名和删除分别进入对应表单，删除仍需显式确认', async () => {
  const action = vi.spyOn(api, 'sessionAction').mockResolvedValue(undefined);
  mount();
  await openAction('重命名');
  const rename = screen.getByRole('dialog', { name: '重命名会话' });
  expect(within(rename).queryByRole('checkbox')).toBeNull();
  fireEvent.change(within(rename).getByLabelText('会话名称'), { target: { value: '新名称' } });
  fireEvent.click(within(rename).getByRole('button', { name: '保存名称' }));
  await waitFor(() =>
    expect(action).toHaveBeenCalledWith('workspace', 'native-id', 'claude', { action: 'rename', title: '新名称' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await openAction('删除');
  const remove = screen.getByRole('dialog', { name: '删除会话' });
  expect(within(remove).queryByLabelText('会话名称')).toBeNull();
  const confirm = within(remove).getByRole<HTMLButtonElement>('button', { name: '确认删除会话' });
  expect(confirm.disabled).toBe(true);
  expect(action).toHaveBeenCalledTimes(1);
  fireEvent.click(within(remove).getByRole('checkbox', { name: /我确认删除/ }));
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(action).toHaveBeenCalledWith('workspace', 'native-id', 'claude', { action: 'delete', confirmed: true }),
  );
});

it('归档菜单仅提供恢复和删除，选择恢复不同时呈现删除控件', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: '已归档' }));
  fireEvent.click(screen.getByRole('button', { name: /Codex.*更多操作/ }));
  expect(await screen.findByRole('menuitem', { name: '恢复' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: '重命名' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: '恢复' }));
  const dialog = screen.getByRole('dialog', { name: '恢复会话' });
  expect(within(dialog).getByRole('button', { name: '恢复到会话列表' })).toBeTruthy();
  expect(within(dialog).queryByRole('checkbox')).toBeNull();
  expect(within(dialog).queryByRole('button', { name: '确认删除会话' })).toBeNull();
});

it('运行中会话的更多菜单禁用，不发起管理请求', () => {
  mount();
  act(() => useChat.setState({ sessionId: session.sessionId, running: true }));
  const more = screen.getByRole<HTMLButtonElement>('button', { name: /更多操作/ });
  expect(more.disabled).toBe(true);
  fireEvent.click(more);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('归档列表成功为空时显示中性空状态，仍只读取Codex原生归档', async () => {
  client.removeQueries({ queryKey: queryKeys.sessions('workspace', 'codex', true), exact: true });
  const list = vi.spyOn(api, 'listSessions').mockResolvedValue([]);
  mount();
  fireEvent.click(screen.getByRole('button', { name: '已归档' }));
  expect(await screen.findByText('暂无归档会话')).toBeTruthy();
  expect(list).toHaveBeenCalledExactlyOnceWith('workspace', 'codex', true);
  expect(screen.queryByRole('alert')).toBeNull();
});
