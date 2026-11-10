// @vitest-environment jsdom
import { sessionsApi, sessionsKeys } from '../../../src/features/sessions/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { SessionList } from '../../../src/features/sessions/SessionList';
import { useChat } from '../../../src/features/chat/chat-store';
import { useSessionPins } from '../../../src/features/sessions/session-preferences';

const session = {
  agent: 'claude' as const,
  sessionId: 'native-id',
  projectId: null,
  title: '原生历史仍可打开',
  updatedAt: new Date(1).toISOString(),
  running: false,
};
const archived = {
  agent: 'codex' as const,
  sessionId: 'archived-id',
  projectId: null,
  title: '归档记录',
  updatedAt: new Date(2).toISOString(),
  running: false,
};
let client: QueryClient;
beforeEach(() => {
  vi.spyOn(sessionsApi, 'sessionPermission').mockResolvedValue({ permission: null });
  useSessionPins.setState({ pins: [] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } } });
  client.setQueryData(sessionsKeys.sessions('workspace', 'claude'), [session]);
  client.setQueryData(sessionsKeys.sessions('workspace', 'codex'), []);
  client.setQueryData(sessionsKeys.sessions('workspace', 'antigravity'), []);
  client.setQueryData(sessionsKeys.sessions('workspace', 'codex', true), [archived]);
  client.setQueryData(sessionsKeys.sessions('workspace', 'claude', true), []);
  client.setQueryData(sessionsKeys.sessions('workspace', 'antigravity', true), []);
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
  vi.unstubAllGlobals();
});
function mount() {
  render(
    <QueryClientProvider client={client}>
      <SessionList workspaceId="workspace" />
    </QueryClientProvider>,
  );
}
async function openAction(name: string, agent = 'Claude', title = session.title) {
  fireEvent.click(screen.getByRole('button', { name: `${agent} 会话“${title}”的更多操作` }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

it('Codex来源失败仍保留Claude历史与独立重试入口', async () => {
  client.removeQueries({ queryKey: sessionsKeys.sessions('workspace', 'codex') });
  await client
    .fetchQuery({
      queryKey: sessionsKeys.sessions('workspace', 'codex'),
      queryFn: () => Promise.reject(new Error('运行时不可用')),
    })
    .catch(() => undefined);
  mount();
  expect(screen.getByText(session.title)).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('运行时不可用');
  expect(screen.getByRole('button', { name: '重新读取 Codex' })).toBeTruthy();
});

/** 历史接口返回原生记录行，列表行与它是两套契约。 */
const history = {
  agent: session.agent,
  sessionId: session.sessionId,
  summary: session.title,
  lastModified: Date.parse(session.updatedAt),
};

it('标题仅选择会话，更多先展示菜单，不直接打开综合管理弹窗', async () => {
  const read = vi.spyOn(sessionsApi, 'sessionEvents').mockResolvedValue({ session: history, events: [] });
  mount();
  const title = screen.getByText(session.title);
  // 行尾新增相对更新时间（lastModified=1 → “1/1”），标题文本本身保持单行省略。
  expect(title.textContent).toBe(session.title);
  expect(title.closest('button')?.textContent).toContain(session.title);
  expect(title.closest('button')?.textContent).toContain('1/1');
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
  const action = vi.spyOn(sessionsApi, 'sessionAction').mockResolvedValue(undefined);
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
  fireEvent.click(within(remove).getByRole('checkbox', { name: /确认删除/ }));
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

it('运行中会话允许复制但禁用管理请求', async () => {
  mount();
  act(() => useChat.setState({ sessionId: session.sessionId, running: true }));
  const more = screen.getByRole<HTMLButtonElement>('button', { name: /更多操作/ });
  expect(more.disabled).toBe(false);
  fireEvent.click(more);
  expect((await screen.findByRole('menuitem', { name: '删除' })).getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByRole('menuitem', { name: '复制会话 ID' }).getAttribute('aria-disabled')).not.toBe('true');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('归档列表成功为空时显示中性空状态，并复用其他来源缓存', async () => {
  client.removeQueries({ queryKey: sessionsKeys.sessions('workspace', 'codex', true), exact: true });
  const list = vi.spyOn(sessionsApi, 'listSessions').mockResolvedValue([]);
  mount();
  fireEvent.click(screen.getByRole('button', { name: '已归档' }));
  expect(await screen.findByText('暂无归档会话')).toBeTruthy();
  expect(list).toHaveBeenCalledExactlyOnceWith('workspace', 'codex', true, expect.any(AbortSignal));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('普通会话按Codex与Claude分别成组，不混排来源', () => {
  client.setQueryData(sessionsKeys.sessions('workspace', 'codex'), [{ ...archived, title: 'Codex 活跃会话' }]);
  mount();
  const codex = screen.getByRole('region', { name: 'Codex 会话' });
  const claude = screen.getByRole('region', { name: 'Claude 会话' });
  expect(within(codex).getByText('Codex 活跃会话')).toBeTruthy();
  expect(within(claude).getByText(session.title)).toBeTruthy();
  expect(within(codex).queryByText(session.title)).toBeNull();
});

it('置顶只改变当前来源的排序，取消置顶恢复按更新时间排序', async () => {
  client.setQueryData(sessionsKeys.sessions('workspace', 'claude'), [
    session,
    { ...session, sessionId: 'newer', title: '较新会话', updatedAt: new Date(20).toISOString() },
  ]);
  mount();
  await openAction('置顶');
  const group = screen.getByRole('region', { name: 'Claude 会话' });
  expect(within(group).getAllByRole('listitem')[0]?.textContent).toContain(session.title);
  await openAction('取消置顶');
  expect(within(group).getAllByRole('listitem')[0]?.textContent).toContain('较新会话');
});

it('复制稳定会话链接，末尾分叉先呈现原生操作说明', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  mount();
  await openAction('复制会话链接');
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const copied = new URL(writeText.mock.calls[0]![0] as string);
  expect(copied.protocol).toBe('agentdeck:');
  expect(copied.href).toBe('agentdeck://session?workspace=workspace&agent=claude&id=native-id');
  expect(await screen.findByText(/会话链接已复制/)).toBeTruthy();
  await openAction('创建分支');
  const dialog = screen.getByRole('dialog', { name: '创建分支' });
  expect(dialog.textContent).toContain('源会话保持不变');
  expect(within(dialog).getByRole('button', { name: '创建分支' })).toBeTruthy();
  vi.unstubAllGlobals();
});
