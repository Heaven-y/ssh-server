// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionHistory, Workspace } from '@ssh-server/shared';
import { useWorkspaceNavigation } from '../../src/app/use-workspace-navigation';
import { useChat } from '../../src/features/chat/chat-store';
import { api } from '../../src/lib/api';

const workspaces: Workspace[] = ['one', 'two'].map((id) => ({
  id,
  name: id,
  localDir: '/projects/demo',
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
}));
const history = (sessionId: string, agent: 'codex' | 'claude' = 'codex'): SessionHistory => ({
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
  vi.spyOn(api, 'sessionEvents').mockImplementation(async (_workspace, id, agent) => history(id, agent));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('初始链接等待工作区列表后优先定位原生会话，后续hash变化继续导航', async () => {
  localStorage.setItem('ssh-server.lastWorkspace', 'one');
  hash('#session?workspace=two&agent=codex&id=native-two');
  const { rerender } = renderHook(({ list }) => useWorkspaceNavigation(list), {
    initialProps: { list: undefined as Workspace[] | undefined },
  });
  expect(api.sessionEvents).not.toHaveBeenCalled();
  rerender({ list: workspaces });
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

it('非法或不存在的工作区链接只提示，不发送历史请求', () => {
  hash('#session?workspace=other&agent=codex&id=native');
  renderHook(() => useWorkspaceNavigation(workspaces));
  expect(useChat.getState().banner).toContain('链接中的工作区不存在');
  act(() => hash('#session?workspace=one&agent=codex&id=../bad'));
  expect(useChat.getState().banner).toContain('会话链接格式无效');
  expect(api.sessionEvents).not.toHaveBeenCalled();
});

it('当前轮次或原生管理尚未结束时链接不切走会话，也不在结束后自动重试', () => {
  useChat.getState().selectWorkspace('one');
  useChat.setState({ sessionId: 'current', running: true });
  renderHook(() => useWorkspaceNavigation(workspaces));
  act(() => hash('#session?workspace=two&agent=codex&id=next'));
  expect(useChat.getState()).toMatchObject({ workspaceId: 'one', sessionId: 'current', running: true });
  expect(useChat.getState().banner).toContain('结束当前会话操作后再打开链接');
  act(() => useChat.setState({ running: false }));
  expect(api.sessionEvents).not.toHaveBeenCalled();
});

it('迟到历史不会覆盖之后的选择；工作区查询迟到也不能重放初始链接', async () => {
  let resolve!: (value: SessionHistory) => void;
  vi.mocked(api.sessionEvents).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  hash('#session?workspace=two&agent=codex&id=old');
  const mounted = renderHook(() => useWorkspaceNavigation(workspaces));
  await waitFor(() => expect(api.sessionEvents).toHaveBeenCalledTimes(1));
  act(() => useChat.getState().newSession('claude'));
  await act(async () => resolve(history('old')));
  expect(useChat.getState()).toMatchObject({ agent: 'claude', sessionId: undefined, items: [] });
  mounted.unmount();
  const delayed = renderHook(({ list }) => useWorkspaceNavigation(list), {
    initialProps: { list: undefined as Workspace[] | undefined },
  });
  act(() => useChat.getState().selectWorkspace('one'));
  delayed.rerender({ list: workspaces });
  expect(useChat.getState()).toMatchObject({ workspaceId: 'one', sessionId: undefined });
  expect(api.sessionEvents).toHaveBeenCalledTimes(1);
});
