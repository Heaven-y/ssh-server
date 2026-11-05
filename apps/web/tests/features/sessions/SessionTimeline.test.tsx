// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@agentdeck/shared';
import { AgentBadge } from '../../../src/features/sessions/AgentBadge';
import { SessionHeader } from '../../../src/features/sessions/SessionHeader';
import { SessionTimeline } from '../../../src/features/sessions/SessionTimeline';

afterEach(cleanup);

const userEvent: AgentEvent = { type: 'user_message', text: '检查这个脚本' };
const assistantEvent: AgentEvent = { type: 'text', delta: '已检查' };

it('渲染用户与助手消息', () => {
  render(<SessionTimeline events={[userEvent, assistantEvent]} />);
  expect(screen.getByText('检查这个脚本')).toBeTruthy();
  expect(screen.getByText('已检查')).toBeTruthy();
});

it('把连续文本增量合并成一条助手消息，并让流式状态落定', () => {
  render(
    <SessionTimeline
      events={[
        userEvent,
        { type: 'text', delta: '答' },
        { type: 'text', delta: '案' },
        { type: 'turn_end', isError: false, forkPoint: 'native-turn-1' },
      ]}
    />,
  );
  expect(screen.getByText('答案')).toBeTruthy();
  // M1 只读：历史里不出现「从此处创建分支」这类交互入口。
  expect(screen.queryByText('从此处创建分支')).toBeNull();
});

it('工具调用与结果复用既有工具卡片', () => {
  render(
    <SessionTimeline
      events={[
        { type: 'tool_call', id: 'tool-1', name: 'Read', input: { file_path: 'src/example.py' } },
        { type: 'tool_result', id: 'tool-1', output: 'print(1)', isError: false },
        { type: 'turn_end', isError: false },
      ]}
    />,
  );
  expect(screen.getByText('Read')).toBeTruthy();
  expect(screen.getByText('src/example.py')).toBeTruthy();
});

it('Antigravity 不可回放时显示说明而不是空白', () => {
  render(<SessionTimeline events={[]} notReplayable />);
  expect(screen.getByText(/无法读取/)).toBeTruthy();
  expect(screen.queryByRole('log')).toBeNull();
});

it('读取失败时显示原因并可重试，不与不可回放混为一谈', () => {
  const retry = vi.fn();
  render(
    <SessionTimeline
      events={[]}
      error={{ kind: 'network', message: '无法连接本机服务，请确认后端已启动后重试。' }}
      onRetry={retry}
    />,
  );
  expect(screen.getByRole('alert').textContent).toContain('无法连接本机服务');
  expect(screen.queryByText(/无法读取/)).toBeNull();
  screen.getByRole('button', { name: '重新读取' }).click();
  expect(retry).toHaveBeenCalledTimes(1);
});

it('底部说明 M2 才接入对话，M1 不提供输入框', () => {
  render(<SessionTimeline events={[userEvent]} />);
  expect(screen.getByText(/M2 接入对话/)).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('空标题显示占位', () => {
  render(<SessionHeader agent="claude" title="" version="2.1.317" projectDir="~/projects/demo" />);
  expect(screen.getByText('未命名会话')).toBeTruthy();
});

it('会话头显示 CLI、实际驱动版本、项目路径与运行状态', () => {
  render(<SessionHeader agent="codex" title="解释构建失败" version="0.166.0" projectDir={'E:\\web\\demo'} running />);
  expect(screen.getByRole('heading', { name: '解释构建失败' })).toBeTruthy();
  expect(screen.getByText('Codex')).toBeTruthy();
  expect(screen.getByText('0.166.0')).toBeTruthy();
  expect(screen.getByText('E:\\web\\demo')).toBeTruthy();
  expect(screen.getByText('运行中')).toBeTruthy();
});

it('CLI 徽标用首字母并保留完整名称', () => {
  render(<AgentBadge agent="antigravity" />);
  expect(screen.getByText('A')).toBeTruthy();
  expect(screen.getByTitle('Antigravity')).toBeTruthy();
});
