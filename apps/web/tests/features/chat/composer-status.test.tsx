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
  expect(screen.getByText('60.0 tok/s')).toBeTruthy();
  expect(screen.queryByText('输入 300')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '本轮统计详情' }));
  expect(await screen.findByRole('dialog', { name: '本轮统计详情' })).toBeTruthy();
  expect(screen.getByText('输入 300')).toBeTruthy();
  act(() => useChat.setState({ running: true }));
  expect(screen.getByRole('button', { name: '本轮统计详情' }).textContent).toContain('— tok/s');
  expect(screen.queryByText('60.0 tok/s')).toBeNull();
});

it('没有原生统计时固定显示未知值，不伪造零速与窗口', () => {
  render(<ComposerStatus />);
  expect(screen.getByText('— tok/s')).toBeTruthy();
  expect(screen.getByText('上下文 —')).toBeTruthy();
  expect(screen.queryByText('0.0 tok/s')).toBeNull();
});

it('历史压缩完成不替代当前上下文，结果只在详情中出现', async () => {
  useChat.setState({ compaction: { status: 'completed', trigger: 'auto', beforeTokens: 500, afterTokens: 100 } });
  render(<ComposerStatus />);
  const button = screen.getByRole('button', { name: '上下文用量' });
  expect(button.textContent).toContain('上下文 —');
  expect(screen.queryByText(/压缩已完成/)).toBeNull();
  fireEvent.click(button);
  expect(await screen.findByText('压缩已完成 · 自动')).toBeTruthy();
  act(() => useChat.setState({ contextUsage: { source: 'codex_native', usedTokens: 100, windowTokens: 200000 } }));
  expect(button.textContent).toContain('100 / 200,000');
  expect(button.textContent).not.toContain('压缩');
});
