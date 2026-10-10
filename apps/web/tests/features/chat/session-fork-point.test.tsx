// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MessageItem } from '../../../src/features/chat/MessageItem';
import { useChat } from '../../../src/features/chat/chat-store';
import * as operations from '../../../src/features/workspaces/session-fork';

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient();
  useChat.setState(useChat.getInitialState(), true);
  useChat.getState().selectWorkspace('workspace');
  useChat.setState({ agent: 'codex', sessionId: 'source' });
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
      <MessageItem item={{ kind: 'fork-point', id: 'boundary', pointId: 'native-turn-1' }} />
    </QueryClientProvider>,
  );
}
it('已结束位置打开分叉确认，确认只传原生pointId及当前源身份', async () => {
  const fork = vi.spyOn(operations, 'forkSession').mockResolvedValue(true);
  mount();
  fireEvent.click(screen.getByRole('button', { name: '从此处分叉' }));
  expect(fork).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog').textContent).toContain('包含该位置');
  fireEvent.click(screen.getByRole('button', { name: '确认分叉' }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith('workspace', expect.objectContaining({ agent: 'codex', sessionId: 'source' }), {
      pointId: 'native-turn-1',
    }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('运行中不可从历史位置分叉，结束后恢复入口', () => {
  useChat.setState({ running: true });
  mount();
  const button = screen.getByRole<HTMLButtonElement>('button', { name: '从此处分叉' });
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => useChat.setState({ running: false }));
  expect(button.disabled).toBe(false);
});
