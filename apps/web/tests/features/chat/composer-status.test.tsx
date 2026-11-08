// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ComposerStatus, latestComposerStatistics } from '../../../src/features/chat/ComposerStatus';
import { useChat } from '../../../src/features/chat/chat-store';
import type { ChatItem } from '../../../src/features/chat/chat-reducer';

const statistics: Extract<ChatItem, { kind: 'statistics' }> = {
  kind: 'statistics',
  id: 'stats-one',
  scope: 'turn',
  durationMs: 2000,
  usage: { source: 'claude', scope: 'turn', inputTokens: 300, outputTokens: 120 },
};
beforeEach(() => useChat.setState(useChat.getInitialState(), true));
afterEach(cleanup);

it('仅显示当前用户轮次的已完成统计，运行中或新轮缺值不沿用旧速度', () => {
  const first: ChatItem[] = [{ kind: 'user', id: 'one', text: '第一轮' }, statistics];
  expect(latestComposerStatistics(first, false)).toBe(statistics);
  expect(latestComposerStatistics(first, true)).toBeUndefined();
  expect(latestComposerStatistics([...first, { kind: 'user', id: 'two', text: '第二轮' }], false)).toBeUndefined();
  const step = {
    ...statistics,
    id: 'step-two',
    scope: 'step' as const,
    usage: { ...statistics.usage!, scope: 'step' as const },
  };
  expect(latestComposerStatistics([...first, { kind: 'user', id: 'two', text: '第二轮' }, step], false)).toBe(step);
});

it('底部摘要保留上下文与 tok/s，token 明细按需展开，运行中隐藏旧统计', async () => {
  useChat.setState({
    items: [statistics],
    contextUsage: { source: 'claude_estimate', usedTokens: 1000, windowTokens: 20000 },
  });
  render(<ComposerStatus />);
  expect(screen.getByRole('group', { name: '会话统计' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '上下文用量' })).toBeTruthy();
  expect(
    Array.from(screen.getByRole('group', { name: '会话统计' }).querySelectorAll('button')).map((button) =>
      button.getAttribute('aria-label'),
    ),
  ).toEqual(['本轮统计详情', '上下文用量']);
  expect(screen.getByText('回合平均 60.0 tok/s')).toBeTruthy();
  expect(screen.queryByText('输入 300')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '本轮统计详情' }));
  expect(await screen.findByRole('dialog', { name: '本轮统计详情' })).toBeTruthy();
  expect(screen.getByText('输入 300')).toBeTruthy();
  act(() => useChat.setState({ running: true }));
  expect(screen.queryByRole('button', { name: '本轮统计详情' })).toBeNull();
  expect(screen.queryByText('回合平均 60.0 tok/s')).toBeNull();
});

it('没有原生统计时不显示空行或零速', () => {
  const { container } = render(<ComposerStatus />);
  expect(container.textContent).toBe('');
  expect(screen.queryByRole('group', { name: '会话统计' })).toBeNull();
});
