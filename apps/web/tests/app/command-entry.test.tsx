// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TopBar } from '../../src/app/TopBar';
import { useChat } from '../../src/features/chat/chat-store';

afterEach(cleanup);
it('中央标题栏只展示当前会话和按需右侧栏入口', () => {
  const toggle = vi.fn();
  useChat.setState({ ...useChat.getInitialState(), connection: 'open' });
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <TopBar sidebarOpen={false} onToggleSidebar={toggle} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('heading', { name: '新会话' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '服务器' })).toBeNull();
  expect(screen.queryByRole('button', { name: '终端' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '打开右侧边栏' }));
  expect(toggle).toHaveBeenCalledOnce();
});
