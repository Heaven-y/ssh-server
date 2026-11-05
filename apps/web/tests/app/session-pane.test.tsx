// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionPane } from '../../src/app/SessionPane';
import { useChat } from '../../src/features/chat/chat-store';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

it('没有项目时引导先添加项目，不画空对话框', () => {
  const add = vi.fn();
  mount(<SessionPane onAddProject={add} />);
  expect(screen.getByText('选择一个工作区，开始对话')).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: '输入消息' })).toBeNull();
  screen.getByRole('button', { name: '添加项目目录' }).click();
  expect(add).toHaveBeenCalledTimes(1);
});

it('项目列表读取失败时在原处说明原因', () => {
  mount(<SessionPane error={new Error('本机服务未启动')} />);
  expect(screen.getByRole('alert').textContent).toContain('本机服务未启动');
  expect(screen.queryByText('选择一条会话查看历史')).toBeNull();
});

it('加载中只显示进度，不闪空态', () => {
  mount(<SessionPane pending />);
  expect(screen.getByRole('status').textContent).toBe('正在加载项目…');
  expect(screen.queryByText('选择一个工作区，开始对话')).toBeNull();
});

it('有当前项目时挂载新会话输入，不再停留在只读历史空态', () => {
  useChat.setState(useChat.getInitialState(), true);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
  mount(<SessionPane project={{ id: 'p1', name: '示例项目', dir: 'project' }} />);
  expect(screen.getByRole('heading', { name: '从一条消息开始' })).toBeTruthy();
  expect(screen.getByLabelText('输入消息')).toBeTruthy();
});
