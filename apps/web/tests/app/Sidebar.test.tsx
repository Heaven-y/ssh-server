// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionSummary, Workspace } from '@agentdeck/shared';
import { Sidebar } from '../../src/app/Sidebar';
import { useChat } from '../../src/features/chat/chat-store';

const project: Workspace = { id: 'p1', name: '示例项目', dir: 'E:\\web\\demo' };
const otherProject: Workspace = { id: 'p2', name: '另一个项目', dir: 'E:\\web\\other' };
const base = {
  projectId: 'p1',
  running: false,
  updatedAt: new Date(1).toISOString(),
};
const claudeSession: SessionSummary = {
  ...base,
  agent: 'claude',
  sessionId: 'claude-1',
  title: '检查这个脚本',
};
const codexSession: SessionSummary = {
  ...base,
  agent: 'codex',
  sessionId: 'codex-1',
  title: '解释构建失败',
};
const orphan: SessionSummary = {
  ...base,
  agent: 'claude',
  sessionId: 'orphan-1',
  projectId: null,
  title: '孤儿会话',
};

beforeEach(() => {
  useChat.setState(useChat.getInitialState(), true);
});
afterEach(cleanup);

it('没有项目时显示引导添加项目', () => {
  render(<Sidebar projects={[]} sessionsByProject={{}} onAddProject={vi.fn()} />);
  expect(screen.getByText('添加项目目录')).toBeTruthy();
  expect(screen.getByText('还没有项目')).toBeTruthy();
});

it('按 CLI 分组显示会话并带徽标', () => {
  render(
    <Sidebar projects={[project]} sessionsByProject={{ p1: [claudeSession, codexSession] }} onAddProject={vi.fn()} />,
  );
  expect(screen.getByText('Claude')).toBeTruthy();
  expect(screen.getByText('Codex')).toBeTruthy();
  expect(screen.getByText('检查这个脚本')).toBeTruthy();
  expect(screen.getByText('解释构建失败')).toBeTruthy();
});

it('未归属会话默认不显示', () => {
  render(<Sidebar projects={[project]} sessionsByProject={{ p1: [orphan] }} onAddProject={vi.fn()} />);
  expect(screen.queryByText('孤儿会话')).not.toBeTruthy();
  expect(screen.queryByText('其他目录')).not.toBeTruthy();
});

it('打开“显示其他目录的会话”后才列出未归属会话', () => {
  render(<Sidebar projects={[project]} sessionsByProject={{ p1: [orphan] }} onAddProject={vi.fn()} />);
  fireEvent.click(screen.getByRole('switch', { name: '显示其他目录的会话' }));
  expect(screen.getByText('其他目录')).toBeTruthy();
  expect(screen.getByText('孤儿会话')).toBeTruthy();
});

it('点项目行切换项目，点会话行把它交给调用方', () => {
  const selectProject = vi.fn();
  const selectSession = vi.fn();
  render(
    <Sidebar
      projects={[project, otherProject]}
      sessionsByProject={{ p1: [claudeSession], p2: [] }}
      onAddProject={vi.fn()}
      onSelectProject={selectProject}
      onSelectSession={selectSession}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /另一个项目/ }));
  expect(selectProject).toHaveBeenCalledWith('p2');
  const group = screen.getByRole('region', { name: 'Claude 会话' });
  fireEvent.click(within(group).getByRole('button', { name: /检查这个脚本/ }));
  expect(selectSession).toHaveBeenCalledWith('p1', claudeSession);
});

it('项目目录以等宽路径展示，长列表只在中间滚动', () => {
  render(<Sidebar projects={[project]} sessionsByProject={{ p1: [] }} onAddProject={vi.fn()} />);
  expect(screen.getByText('E:\\web\\demo')).toBeTruthy();
  expect(screen.getByRole('navigation', { name: '项目与会话' })).toBeTruthy();
  expect(screen.getByText('暂无会话')).toBeTruthy();
});
