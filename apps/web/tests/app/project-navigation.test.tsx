// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentKind, SessionHistory, Workspace } from '@agentdeck/shared';
import { useProjectNavigation } from '../../src/app/use-project-navigation';
import { useChat } from '../../src/features/chat/chat-store';
import { api } from '../../src/lib/api';

const projects: Workspace[] = ['one', 'two'].map((id) => ({
  id,
  name: id,
  dir: '/projects/demo',
  server: 'my-server',
  remoteDir: '~/projects/demo',
}));
const history = (sessionId: string, agent: AgentKind = 'codex'): SessionHistory => ({
  session: { sessionId, agent, summary: sessionId, lastModified: 1 },
  events: [{ type: 'text', delta: sessionId }],
});
function hash(value: string) {
  window.history.replaceState(null, '', value || window.location.pathname);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
beforeEach(() => {
  localStorage.clear();
  useChat.setState(useChat.getInitialState(), true);
  hash('');
  vi.spyOn(api, 'sessionEvents').mockImplementation(async (_project, id, agent) => history(id, agent));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('初始链接等待项目列表后优先定位原生会话，后续hash变化继续导航', async () => {
  localStorage.setItem('agentdeck.lastProject', 'one');
  hash('#session?workspace=two&agent=codex&id=native-two');
  const { rerender } = renderHook(({ list }) => useProjectNavigation(list), {
    initialProps: { list: undefined as Workspace[] | undefined },
  });
  expect(api.sessionEvents).not.toHaveBeenCalled();
  rerender({ list: projects });
  await waitFor(() =>
    expect(useChat.getState()).toMatchObject({ workspaceId: 'two', sessionId: 'native-two', loadingHistory: false }),
  );
  act(() => hash('#session?workspace=one&agent=claude&id=native-one'));
  await waitFor(() =>
    expect(useChat.getState()).toMatchObject({
      workspaceId: 'one',
      agent: 'claude',
      sessionId: 'native-one',
      loadingHistory: false,
    }),
  );
});

it('非法或不存在的项目链接只提示，不发送历史请求', () => {
  hash('#session?workspace=other&agent=codex&id=native');
  renderHook(() => useProjectNavigation(projects));
  expect(useChat.getState().banner).toContain('链接中的项目不存在');
  act(() => hash('#session?workspace=one&agent=codex&id=../bad'));
  expect(useChat.getState().banner).toContain('会话链接格式无效');
  expect(api.sessionEvents).not.toHaveBeenCalled();
});

it('当前轮次或原生管理尚未结束时链接不切走会话，也不在结束后自动重试', () => {
  useChat.getState().selectWorkspace('one');
  useChat.setState({ sessionId: 'current', running: true });
  renderHook(() => useProjectNavigation(projects));
  act(() => hash('#session?workspace=two&agent=codex&id=next'));
  expect(useChat.getState()).toMatchObject({ workspaceId: 'one', sessionId: 'current', running: true });
  expect(useChat.getState().banner).toContain('结束当前会话操作后再打开链接');
  act(() => useChat.setState({ running: false }));
  expect(api.sessionEvents).not.toHaveBeenCalled();
});

it('迟到历史不会覆盖之后的选择；项目查询迟到也不能重放初始链接', async () => {
  let resolve!: (value: SessionHistory) => void;
  vi.mocked(api.sessionEvents).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  hash('#session?workspace=two&agent=codex&id=old');
  const mounted = renderHook(() => useProjectNavigation(projects));
  await waitFor(() => expect(api.sessionEvents).toHaveBeenCalledTimes(1));
  act(() => useChat.getState().newSession('claude'));
  await act(async () => resolve(history('old')));
  expect(useChat.getState()).toMatchObject({ agent: 'claude', sessionId: undefined, items: [] });
  mounted.unmount();
  const delayed = renderHook(({ list }) => useProjectNavigation(list), {
    initialProps: { list: undefined as Workspace[] | undefined },
  });
  act(() => useChat.getState().selectWorkspace('one'));
  delayed.rerender({ list: projects });
  expect(useChat.getState()).toMatchObject({ workspaceId: 'one', sessionId: undefined });
  expect(api.sessionEvents).toHaveBeenCalledTimes(1);
});
