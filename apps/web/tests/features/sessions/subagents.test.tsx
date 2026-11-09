// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChat } from '../../../src/features/chat/chat-store';
import { SubagentHistoryButton } from '../../../src/features/sessions/SubagentHistoryDialog';
import { sessionsApi } from '../../../src/features/sessions/api';

vi.mock('../../../src/features/chat/ChatTimeline', () => ({
  ChatTimeline: ({ items }: { items: unknown[] }) => <div>{JSON.stringify(items)}</div>,
}));
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient();
  useChat.setState(useChat.getInitialState(), true);
  useChat.getState().selectWorkspace('project');
  useChat.setState({ agent: 'claude', sessionId: 'parent' });
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
      <SubagentHistoryButton />
    </QueryClientProvider>,
  );
}
it('打开后才读取子代理，分页追加但不写主对话，切换子代理不串内容', async () => {
  const api = vi.spyOn(sessionsApi, 'subagents').mockImplementation(async (_workspace, _session, query) => {
    if (!query.agentId) return { agentIds: ['child-a', 'child-b'] };
    return {
      agentId: query.agentId,
      events: [{ type: 'text', delta: `${query.agentId}-${query.cursor ?? 'first'}` }],
      nextCursor: query.cursor ? undefined : '100',
    };
  });
  const parentItems = useChat.getState().items;
  mount();
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '子代理' }));
  await screen.findByText(/child-a-first/);
  fireEvent.click(screen.getByRole('button', { name: '继续加载' }));
  await screen.findByText(/child-a-100/);
  fireEvent.change(screen.getByRole('combobox', { name: '选择子代理' }), { target: { value: 'child-b' } });
  await screen.findByText(/child-b-first/);
  expect(screen.queryByText(/child-a-first/)).toBeNull();
  expect(useChat.getState().items).toBe(parentItems);
  fireEvent.click(screen.getByRole('button', { name: '关闭子代理历史' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('其他CLI不显示未接入的子代理入口', () => {
  useChat.setState({ agent: 'codex' });
  mount();
  expect(screen.queryByRole('button', { name: '子代理' })).toBeNull();
});
