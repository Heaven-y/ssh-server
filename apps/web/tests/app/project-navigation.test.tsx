// @vitest-environment jsdom
import { sessionsApi } from '../../src/features/sessions/api';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentKind, SessionHistory } from '@agentdeck/shared/conversation';
import type { Workspace } from '@agentdeck/shared/projects';
import { useProjectNavigation } from '../../src/app/use-project-navigation';
import { useChat } from '../../src/features/chat/chat-store';
import { navigateToSessionReference } from '../../src/features/sessions/session-links';
import { StrictMode } from 'react';

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
  vi.spyOn(sessionsApi, 'sessionPermission').mockResolvedValue({ permission: null });
  localStorage.clear();
  useChat.setState(useChat.getInitialState(), true);
  hash('');
  vi.spyOn(sessionsApi, 'sessionEvents').mockImplementation(async (_project, id, agent) => history(id, agent));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'agentDeck', { configurable: true, value: undefined });
});

it('StrictMode 重挂载不会丢失已消费的桌面初始引用', async () => {
  const initial = vi.fn().mockResolvedValue('agentdeck://session?workspace=two&agent=claude&id=initial-session');
  Object.defineProperty(window, 'agentDeck', {
    configurable: true,
    value: { sessionLinks: { initial, onOpen: () => () => {} } },
  });
  renderHook(() => useProjectNavigation(projects), { wrapper: StrictMode });
  await waitFor(() => expect(useChat.getState().sessionId).toBe('initial-session'));
  expect(initial).toHaveBeenCalledOnce();
});

it('重复点击相同引用会重新定位，桌面收到新引用可以跨 CLI 打开', async () => {
  let onOpen!: (reference: string) => void;
  let resolveInitial!: (reference?: string) => void;
  const unsubscribe = vi.fn();
  const bridge = {
    sessionLinks: {
      onOpen: (listener: (reference: string) => void) => {
        onOpen = listener;
        return unsubscribe;
      },
      initial: () =>
        new Promise<string | undefined>((resolve) => {
          resolveInitial = resolve;
        }),
    },
  };
  Object.defineProperty(window, 'agentDeck', { configurable: true, value: bridge });
  const mounted = renderHook(() => useProjectNavigation(projects));
  const reference = 'agentdeck://session?workspace=two&agent=antigravity&id=agy-session';
  act(() => onOpen(reference));
  await waitFor(() => expect(useChat.getState().sessionId).toBe('agy-session'));
  await act(async () => resolveInitial('agentdeck://session?workspace=one&agent=codex&id=stale'));
  expect(useChat.getState().sessionId).toBe('agy-session');
  act(() => useChat.getState().newSession('claude'));
  act(() => navigateToSessionReference(reference));
  await waitFor(() => expect(useChat.getState()).toMatchObject({ agent: 'antigravity', sessionId: 'agy-session' }));
  mounted.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
  Object.defineProperty(window, 'agentDeck', { configurable: true, value: undefined });
});

it('初始链接等待项目列表后优先定位原生会话，后续hash变化继续导航', async () => {
  localStorage.setItem('agentdeck.lastProject', 'one');
  hash('#session?workspace=two&agent=codex&id=native-two');
  const { rerender } = renderHook(({ list }) => useProjectNavigation(list), {
    initialProps: { list: undefined as Workspace[] | undefined },
  });
  expect(sessionsApi.sessionEvents).not.toHaveBeenCalled();
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
  expect(sessionsApi.sessionEvents).not.toHaveBeenCalled();
});

it('运行期间深链接可打开其他会话，原回合继续在后台', async () => {
  useChat.getState().selectWorkspace('one');
  useChat.setState({ sessionId: 'current', running: true });
  const id = useChat.getState().conversationId;
  renderHook(() => useProjectNavigation(projects));
  act(() => hash('#session?workspace=two&agent=codex&id=next'));
  await waitFor(() =>
    expect(useChat.getState()).toMatchObject({ workspaceId: 'two', sessionId: 'next', loadingHistory: false }),
  );
  expect(useChat.getState().background[id]).toMatchObject({ workspaceId: 'one', sessionId: 'current', running: true });
});

it('迟到历史不会覆盖之后的选择；项目查询迟到也不能重放初始链接', async () => {
  let resolve!: (value: SessionHistory) => void;
  vi.mocked(sessionsApi.sessionEvents).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  hash('#session?workspace=two&agent=codex&id=old');
  const mounted = renderHook(() => useProjectNavigation(projects));
  await waitFor(() => expect(sessionsApi.sessionEvents).toHaveBeenCalledTimes(1));
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
  expect(sessionsApi.sessionEvents).toHaveBeenCalledTimes(1);
});
