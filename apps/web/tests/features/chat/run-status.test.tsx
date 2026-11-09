// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RunStatus } from '../../../src/features/chat/RunStatus';
import { ToolCard } from '../../../src/features/chat/ToolCard';
import { useChat } from '../../../src/features/chat/chat-store';
import type { ChatItem } from '../../../src/features/chat/chat-reducer';

const user: ChatItem = { kind: 'user', id: 'u', text: '检查示例' };
beforeEach(() => {
  useChat.setState(useChat.getInitialState(), true);
  vi.useFakeTimers();
  vi.setSystemTime(1000);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each([
  { agent: 'claude' as const, toolName: 'WebSearch', label: '搜索网页', input: { query: '示例' } },
  { agent: 'codex' as const, toolName: 'fileChange', label: '修改文件', input: { changes: [{ path: 'example.ts' }] } },
  { agent: 'antigravity' as const, toolName: 'run_command', label: '执行命令', input: { CommandLine: 'echo ok' } },
])('$agent：无正文时持续显示运行和用时，按本轮事件更新，结束后不遗留', ({ agent, toolName, label, input }) => {
  useChat.setState({ agent, running: true, pendingClientTurnId: 'pending', lastSentAt: 1000, items: [user] });
  render(<RunStatus />);
  expect(screen.getByRole('status').textContent).toContain('正在准备');
  act(() => {
    useChat.setState({ pendingClientTurnId: undefined });
    vi.advanceTimersByTime(3000);
  });
  expect(screen.getByRole('status').textContent).toContain('等待模型响应');
  expect(screen.getByText('3 秒')).toBeTruthy();
  if (agent !== 'antigravity') {
    act(() => useChat.setState({ items: [user, { kind: 'reasoning', id: 'r', text: '公开思考摘要' }] }));
    expect(screen.getByRole('status').textContent).toContain('正在思考');
  }
  act(() => useChat.setState({ items: [user, { kind: 'assistant', id: 'a', text: '正在检查', streaming: true }] }));
  expect(screen.getByRole('status').textContent).toContain('正在生成回复');
  const tool: ChatItem = {
    kind: 'tool',
    id: 't',
    name: toolName,
    input,
    status: 'running',
  };
  act(() => useChat.setState({ items: [user, tool] }));
  expect(screen.getByRole('status').textContent).toContain(label);
  if (agent !== 'antigravity') {
    act(() => useChat.setState({ items: [user, tool, { kind: 'permission', id: 'p', toolName, input }] }));
    expect(screen.getByRole('status').textContent).toContain('等待批准');
  }
  act(() => useChat.setState({ interruptRequested: true }));
  expect(screen.getByRole('status').textContent).toContain('正在停止');
  act(() => useChat.setState({ running: false }));
  expect(screen.queryByRole('status')).toBeNull();
  act(() => useChat.setState({ running: true, interruptRequested: false, items: [tool, { ...user, id: 'next' }] }));
  expect(screen.getByRole('status').textContent).toContain('等待模型响应');
  expect(screen.getByRole('status').textContent).not.toContain(label);
});

it('工具摘要保留中文动作，展开查看公开说明，未知工具保留原名', () => {
  const item = {
    kind: 'tool' as const,
    id: 't',
    name: 'run_command',
    input: { CommandLine: 'echo ok', toolSummary: '验证示例脚本' },
    status: 'running' as const,
  };
  const view = render(<ToolCard item={item} expanded={false} />);
  const summary = view.container.querySelector('summary')!;
  expect(summary.textContent).toContain('执行命令');
  expect(summary.textContent).not.toContain('验证示例脚本');
  view.rerender(<ToolCard item={item} expanded />);
  expect(screen.getByText('验证示例脚本')).toBeTruthy();
  view.rerender(<ToolCard item={{ ...item, name: 'custom_tool', input: {}, progress: '已检查 2 项' }} expanded />);
  expect(summary.textContent).toContain('custom_tool');
  expect(screen.getByText('已检查 2 项')).toBeTruthy();
});
