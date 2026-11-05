// @vitest-environment jsdom
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AddProjectDialog } from '../../src/app/AddProjectDialog';
import { api, queryKeys } from '../../src/lib/api';
import { useChat } from '../../src/features/chat/chat-store';
import { useOtherSessions } from '../../src/app/use-project-sessions';

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useChat.setState(useChat.getInitialState(), true);
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
  delete window.agentDeck;
  vi.restoreAllMocks();
});

function OtherSessionTitles() {
  const { sessions } = useOtherSessions(true);
  return <div aria-label="其他目录会话">{sessions.map((session) => session.title).join(',')}</div>;
}

function mount(initialDir?: string, showOthers = false) {
  const close = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AddProjectDialog initialDir={initialDir} onClose={close} />
      {showOthers && <OtherSessionTitles />}
    </QueryClientProvider>,
  );
  return close;
}

it('项目目录必填，名称留空时取目录最后一段并选中新项目', async () => {
  const created = { id: 'p1', name: 'demo', dir: path.resolve('fixtures', 'demo') };
  const create = vi.spyOn(api, 'createProject').mockResolvedValue(created);
  client.setQueryData(queryKeys.workspaces, []);
  const close = mount();
  const dialog = screen.getByRole('dialog', { name: '添加项目目录' });
  const submit = within(dialog).getByRole<HTMLButtonElement>('button', { name: '添加项目' });
  expect(submit.disabled).toBe(true);
  fireEvent.change(within(dialog).getByLabelText('项目目录'), { target: { value: created.dir } });
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);
  await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'demo', dir: created.dir }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(useChat.getState().workspaceId).toBe(created.id);
  expect(client.getQueryState(queryKeys.workspaces)?.isInvalidated).toBe(true);
});

it('桌面选择文件夹只填入路径，确认添加时才创建项目', async () => {
  const dir = path.resolve('fixtures', 'selected-project');
  const selectDirectory = vi.fn().mockResolvedValue(dir);
  window.agentDeck = { platform: process.platform, selectDirectory };
  const create = vi.spyOn(api, 'createProject').mockResolvedValue({ id: 'selected', name: 'selected-project', dir });
  mount();
  fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('项目目录').value).toBe(dir));
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '添加项目' }));
  await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'selected-project', dir }));
});

it('其他目录添加为项目后立即刷新归属，移除原来的无归属条目', async () => {
  const dir = path.resolve('fixtures', 'discovered');
  let assigned = false;
  vi.spyOn(api, 'orphanSessions').mockImplementation(async (agent) =>
    agent === 'claude' && !assigned
      ? [
          {
            agent,
            sessionId: 'native',
            title: '待归属会话',
            updatedAt: '2026-11-05T00:00:00Z',
            projectId: null,
            running: false,
            directory: dir,
          },
        ]
      : [],
  );
  vi.spyOn(api, 'createProject').mockImplementation(async () => {
    assigned = true;
    return { id: 'discovered', name: 'discovered', dir };
  });
  const close = mount(dir, true);
  await waitFor(() => expect(screen.getByLabelText('其他目录会话').textContent).toBe('待归属会话'));
  fireEvent.click(screen.getByRole('button', { name: '添加项目' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(screen.getByLabelText('其他目录会话').textContent).toBe('');
});

it('后端拒绝时保留输入并把原因写在原处', async () => {
  const create = vi.spyOn(api, 'createProject').mockRejectedValue(new Error('项目目录不存在'));
  const close = mount();
  const dialog = screen.getByRole('dialog', { name: '添加项目目录' });
  const missing = path.resolve('fixtures', 'missing');
  fireEvent.change(within(dialog).getByLabelText('项目目录'), { target: { value: missing } });
  fireEvent.click(within(dialog).getByRole('button', { name: '添加项目' }));
  expect(await within(dialog).findByRole('alert')).toHaveProperty('textContent', '项目目录不存在');
  expect(within(dialog).getByLabelText<HTMLInputElement>('项目目录').value).toBe(missing);
  expect(create).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
});

it('原生会话目录预填后可直接添加，迟到成功保留用户后来选择的项目', async () => {
  const dir = path.resolve('fixtures', 'session-project');
  let resolve!: (value: { id: string; name: string; dir: string }) => void;
  vi.spyOn(api, 'createProject').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mount(dir);
  expect(screen.getByLabelText<HTMLInputElement>('项目目录').value).toBe(dir);
  fireEvent.click(screen.getByRole('button', { name: '添加项目' }));
  act(() => useChat.getState().selectWorkspace('new-choice'));
  await act(async () => resolve({ id: 'created', name: 'session-project', dir }));
  expect(useChat.getState().workspaceId).toBe('new-choice');
});
