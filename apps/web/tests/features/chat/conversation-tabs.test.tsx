// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChat } from '../../../src/features/chat/chat-store';
import { ConversationTabs } from '../../../src/features/chat/ConversationTabs';
import { sessionsApi } from '../../../src/features/sessions/api';

const projects = [
  { id: 'one', name: '项目一', dir: 'project-one' },
  { id: 'two', name: '项目二', dir: 'project-two' },
];
beforeEach(() => {
  vi.spyOn(sessionsApi, 'sessionPermission').mockResolvedValue({ permission: null });
  useChat.setState(useChat.getInitialState(), true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('标签跨项目切换、关闭和重新打开保留草稿，不产生重复标签', async () => {
  useChat.getState().selectWorkspace('one');
  useChat.getState().newSession('claude');
  useChat.getState().setDraft('待处理草稿');
  const first = useChat.getState().conversationId;
  useChat.getState().selectWorkspace('two');
  useChat.getState().newSession('codex');
  const second = useChat.getState().conversationId;
  render(<ConversationTabs projects={projects} />);
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  fireEvent.click(screen.getByRole('tab', { name: '待处理草稿' }));
  expect(useChat.getState()).toMatchObject({ workspaceId: 'one', conversationId: first, draft: '待处理草稿' });
  fireEvent.click(screen.getByRole('button', { name: '关闭标签“待处理草稿”' }));
  expect(useChat.getState().conversationId).toBe(second);
  expect(useChat.getState().background[first]?.draft).toBe('待处理草稿');
  act(() => {
    useChat.getState().openConversation(first);
    useChat.getState().openConversation(first);
  });
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: '待处理草稿' }).getAttribute('aria-selected')).toBe('true'),
  );
  expect(screen.getAllByRole('tab')).toHaveLength(2);
});

it('关闭最后一个运行标签只移出导航，后台任务仍可从原身份打开', () => {
  useChat.getState().selectWorkspace('one');
  useChat.getState().newSession();
  const id = useChat.getState().conversationId;
  useChat.setState({ running: true, turnId: 'active-turn', title: '执行任务' });
  render(<ConversationTabs projects={projects} />);
  fireEvent.click(screen.getByRole('button', { name: '关闭标签“执行任务”' }));
  expect(screen.queryByRole('tablist')).toBeNull();
  expect(useChat.getState().background[id]).toMatchObject({
    running: true,
    turnId: 'active-turn',
    interruptRequested: false,
  });
  act(() => useChat.getState().openConversation(id));
  expect(screen.getAllByRole('tab')).toHaveLength(1);
  expect(useChat.getState()).toMatchObject({ conversationId: id, running: true, turnId: 'active-turn' });
});

it('重排、归档及移除项目只改变对应标签，保留其他会话', async () => {
  vi.spyOn(sessionsApi, 'sessionEvents').mockImplementation(async (_project, sessionId, agent) => ({
    session: { agent, sessionId, summary: sessionId, lastModified: 1 },
    events: [],
  }));
  vi.spyOn(sessionsApi, 'sessionAction').mockResolvedValue(undefined);
  useChat.getState().selectWorkspace('one');
  await useChat.getState().openSession({ agent: 'claude', sessionId: 'history-one' });
  const first = useChat.getState().conversationId;
  useChat.getState().selectWorkspace('two');
  await useChat.getState().openSession({ agent: 'codex', sessionId: 'history-two' });
  const second = useChat.getState().conversationId;
  useChat.getState().moveConversationTab(second, first);
  expect(useChat.getState().tabIds).toEqual([second, first]);
  useChat.getState().openConversation(first);
  await useChat.getState().manageSession('one', { agent: 'claude', sessionId: 'history-one' }, { action: 'archive' });
  expect(useChat.getState().tabIds).toEqual([second]);
  expect(useChat.getState().conversationId).toBe(second);
  useChat.getState().removeWorkspace('two');
  expect(useChat.getState().tabIds).toEqual([]);
});

it('跨项目打开指定会话时不会顺带重开已经关闭的标签', async () => {
  vi.spyOn(sessionsApi, 'sessionEvents').mockImplementation(async (_project, sessionId, agent) => ({
    session: { agent, sessionId, summary: sessionId, lastModified: 1 },
    events: [],
  }));
  useChat.getState().selectWorkspace('one');
  await useChat.getState().openSession({ agent: 'claude', sessionId: 'old' });
  const closed = useChat.getState().conversationId;
  useChat.getState().closeConversationTab(closed);
  useChat.getState().selectWorkspace('two');
  await useChat.getState().openSession({ agent: 'codex', sessionId: 'other' });
  const other = useChat.getState().conversationId;
  useChat.getState().selectWorkspace('one', { restore: false });
  await useChat.getState().openSession({ agent: 'claude', sessionId: 'chosen' });
  expect(useChat.getState().tabIds).toEqual([other, useChat.getState().conversationId]);
  expect(useChat.getState().tabIds).not.toContain(closed);
});
