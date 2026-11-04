// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AddProjectDialog } from '../../src/app/AddProjectDialog';
import { api, queryKeys } from '../../src/lib/api';
import { useChat } from '../../src/features/chat/chat-store';

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
  vi.restoreAllMocks();
});

function mount() {
  const close = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AddProjectDialog onClose={close} />
    </QueryClientProvider>,
  );
  return close;
}

it('项目目录必填，名称留空时取目录最后一段并选中新项目', async () => {
  const created = { id: 'p1', name: 'demo', dir: 'E:\\web\\demo' };
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

it('后端拒绝时保留输入并把原因写在原处', async () => {
  const create = vi.spyOn(api, 'createProject').mockRejectedValue(new Error('项目目录不存在'));
  const close = mount();
  const dialog = screen.getByRole('dialog', { name: '添加项目目录' });
  fireEvent.change(within(dialog).getByLabelText('项目目录'), { target: { value: 'E:\\web\\missing' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '添加项目' }));
  expect(await within(dialog).findByRole('alert')).toHaveProperty('textContent', '项目目录不存在');
  expect(within(dialog).getByLabelText<HTMLInputElement>('项目目录').value).toBe('E:\\web\\missing');
  expect(create).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
});
