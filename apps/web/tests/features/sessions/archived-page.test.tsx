// @vitest-environment jsdom
import path from 'node:path';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionSummary } from '@agentdeck/shared';
import ArchivedSessionsPage from '../../../src/features/sessions/ArchivedSessionsPage';
import { api, queryKeys } from '../../../src/lib/api';
import { queryClient } from '../../../src/lib/query-client';
import { useChat } from '../../../src/features/chat/chat-store';

const projects = [
  { id: 'first', name: '第一个项目', dir: path.resolve('fixtures', 'first') },
  { id: 'second', name: '第二个项目', dir: path.resolve('fixtures', 'second') },
];
const row = (id: string, projectId: string | null): SessionSummary => ({
  agent: 'codex',
  sessionId: id,
  title: `归档${id}`,
  projectId,
  running: false,
  updatedAt: '2026-11-05T00:00:00Z',
  directory: path.resolve('fixtures', projectId ?? 'orphan'),
});
beforeEach(() => {
  queryClient.clear();
  useChat.setState(useChat.getInitialState(), true);
  useChat.getState().selectWorkspace('first');
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});
function mount(items = projects) {
  const add = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ArchivedSessionsPage projects={items} addProject={add} close={vi.fn()} />
    </QueryClientProvider>,
  );
  return add;
}
it('集中展示跨项目归档，恢复使用来源项目并立即更新列表', async () => {
  let entries = [row('one', 'first'), row('two', 'second')];
  vi.spyOn(api, 'archivedSessions').mockImplementation(async (agent) => (agent === 'codex' ? entries : []));
  const change = vi.spyOn(api, 'sessionAction').mockImplementation(async () => {
    entries = [entries[0]!];
  });
  mount();
  await screen.findByText('归档two');
  const target = screen.getByText('归档two').closest('li')!;
  fireEvent.click(within(target).getByRole('button', { name: '恢复' }));
  fireEvent.click(screen.getByRole('button', { name: '恢复到会话列表' }));
  await waitFor(() => expect(change).toHaveBeenCalledWith('second', 'two', 'codex', { action: 'unarchive' }));
  await waitFor(() => expect(screen.queryByText('归档two')).toBeNull());
  expect(useChat.getState().workspaceId).toBe('first');
});
it('零项目也显示归档，先添加可信目录才能管理', async () => {
  vi.spyOn(api, 'archivedSessions').mockImplementation(async (agent) =>
    agent === 'codex' ? [row('orphan', null)] : [],
  );
  const add = mount([]);
  await screen.findByText('归档orphan');
  expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '加为项目后管理' }));
  expect(add).toHaveBeenCalledWith({ dir: path.resolve('fixtures', 'orphan') });
});
it('归档读取失败保留重试入口，成功空结果显示空态', async () => {
  const read = vi
    .spyOn(api, 'archivedSessions')
    .mockRejectedValueOnce(new Error('原生列表暂不可用'))
    .mockResolvedValue([]);
  mount();
  await screen.findByRole('alert');
  expect(screen.queryByText('暂无已归档会话')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '刷新归档会话' }));
  await screen.findByText('暂无已归档会话');
  expect(read).toHaveBeenCalledTimes(6);
});
it('删除必须确认；归档条目变忙后阻止写入', async () => {
  const session = row('one', 'first');
  vi.spyOn(api, 'archivedSessions').mockImplementation(async (agent) => (agent === 'codex' ? [session] : []));
  const change = vi.spyOn(api, 'sessionAction').mockResolvedValue(undefined);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '删除' }));
  const submit = screen.getByRole<HTMLButtonElement>('button', { name: '确认删除会话' });
  expect(submit.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  await act(() => queryClient.setQueryData(queryKeys.archivedSessions('codex'), [{ ...session, running: true }]));
  await screen.findByText('当前会话正在运行，结束后才能管理。');
  fireEvent.click(submit);
  expect(change).not.toHaveBeenCalled();
  await act(() => queryClient.setQueryData(queryKeys.archivedSessions('codex'), [session]));
  await waitFor(() => expect(screen.queryByText('当前会话正在运行，结束后才能管理。')).toBeNull());
  fireEvent.click(submit);
  await waitFor(() =>
    expect(change).toHaveBeenCalledWith('first', 'one', 'codex', { action: 'delete', confirmed: true }),
  );
});

it('三种来源的归档一起展示，工作台归档恢复按真实来源操作', async () => {
  const records: SessionSummary[] = [
    {
      ...row('claude', 'first'),
      agent: 'claude',
      capabilities: { rename: true, fork: 'native', delete: 'native', archive: 'workbench' },
    },
    {
      ...row('agy', 'second'),
      agent: 'antigravity',
      capabilities: { rename: false, fork: null, delete: null, archive: 'workbench' },
    },
    row('codex', 'first'),
  ];
  vi.spyOn(api, 'archivedSessions').mockImplementation(async (agent) =>
    records.filter((record) => record.agent === agent),
  );
  const change = vi.spyOn(api, 'sessionAction').mockResolvedValue(undefined);
  mount();
  await screen.findByText('归档agy');
  expect(screen.getByText('归档claude')).toBeTruthy();
  expect(screen.getByText('归档codex')).toBeTruthy();
  const agy = screen.getByText('归档agy').closest('li')!;
  expect(within(agy).queryByRole('button', { name: '删除' })).toBeNull();
  fireEvent.click(within(agy).getByRole('button', { name: '恢复' }));
  fireEvent.click(screen.getByRole('button', { name: '恢复到会话列表' }));
  await waitFor(() => expect(change).toHaveBeenCalledWith('second', 'agy', 'antigravity', { action: 'unarchive' }));
});
