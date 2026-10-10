// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionSummary } from '@ssh-server/shared';
import { api, queryKeys } from '../../../src/lib/api';
import { queryClient } from '../../../src/lib/query-client';
import { managementPending, sessionActionKey, useChat } from '../../../src/features/chat/chat-store';
import { forkSession } from '../../../src/features/workspaces/session-fork';

const source: SessionSummary = { agent: 'codex', sessionId: 'source', summary: '源会话', lastModified: 1 };
const created: SessionSummary = { ...source, sessionId: 'forked', summary: '分叉' };
const key = sessionActionKey('workspace', source);
const response = (session = created) => new Response(JSON.stringify({ session }), { status: 200 });
beforeEach(() => {
  useChat.setState(useChat.getInitialState(), true);
  useChat.getState().selectWorkspace('workspace');
  useChat.setState({ agent: 'codex', sessionId: 'source' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response()),
  );
  vi.spyOn(api, 'sessionEvents').mockResolvedValue({ session: created, events: [] });
  vi.spyOn(api, 'sessionAction').mockResolvedValue(undefined);
  vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('指定位置原生分叉仅发一次请求，复用操作锁，成功刷新来源并打开新ID', async () => {
  let resolve!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = forkSession('workspace', source, { pointId: 'native-turn-1' });
  expect(managementPending(useChat.getState())).toBe(true);
  expect(useChat.getState().sessionOperations[key]).toMatchObject({ action: 'fork', pending: true });
  expect(await forkSession('workspace', source, {})).toBe(false);
  expect(await useChat.getState().manageSession('workspace', source, { action: 'rename', title: '不应发送' })).toBe(
    false,
  );
  expect(api.sessionAction).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    '/api/workspaces/workspace/sessions/source/fork?agent=codex',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ pointId: 'native-turn-1' }),
      cache: 'no-store',
    }),
  );
  expect(vi.mocked(fetch).mock.calls[0]![1]?.signal).toBeUndefined();
  resolve(response());
  expect(await pending).toBe(true);
  expect(useChat.getState()).toMatchObject({ sessionId: 'forked', loadingHistory: false });
  expect(useChat.getState().sessionOperations[key]).toBeUndefined();
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.sessions('workspace', 'codex') });
  expect(source.sessionId).toBe('source');
});

it('末尾分叉省略pointId；迟到成功只刷新列表，不能切走新的选择代次', async () => {
  let resolve!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = forkSession('workspace', source, {});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetch).mock.calls[0]![1]?.body).toBe('{}');
  useChat.getState().newSession('claude');
  resolve(response());
  expect(await pending).toBe(true);
  expect(useChat.getState()).toMatchObject({ workspaceId: 'workspace', agent: 'claude', sessionId: undefined });
  expect(api.sessionEvents).not.toHaveBeenCalled();
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.sessions('workspace', 'codex') });
});

it('源会话运行中不发请求，已存在的管理请求也不能被覆盖', async () => {
  useChat.setState({ running: true });
  expect(await forkSession('workspace', source, {})).toBe(false);
  expect(useChat.getState().sessionOperations[key]?.error).toContain('结束');
  const operation = { action: 'delete' as const, pending: true };
  useChat.setState({ running: false, sessionOperations: { [key]: operation } });
  expect(await forkSession('workspace', source, {})).toBe(false);
  expect(useChat.getState().sessionOperations[key]).toEqual(operation);
  expect(fetch).not.toHaveBeenCalled();
});

it('失败释放锁并显示可核对错误，不把未确认结果当新会话', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ message: '会话正在运行', code: 'session_busy' }), { status: 409 }),
  );
  expect(await forkSession('workspace', source, {})).toBe(false);
  expect(useChat.getState().sessionOperations[key]).toMatchObject({ pending: false, error: '会话正在运行' });
  expect(useChat.getState().sessionId).toBe('source');
  expect(await forkSession('workspace', source, {})).toBe(true);
});

it('响应不能复用源ID或改换Agent，用户已离开工作区时不读取分叉历史', async () => {
  for (const session of [source, { ...created, agent: 'claude' as const }]) {
    vi.mocked(fetch).mockResolvedValueOnce(response(session));
    expect(await forkSession('workspace', source, {})).toBe(false);
    expect(useChat.getState().sessionOperations[key]?.error).toContain('身份');
  }
  let resolve!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = forkSession('workspace', source, {});
  useChat.getState().selectWorkspace('other');
  resolve(response());
  expect(await pending).toBe(true);
  expect(useChat.getState().workspaceId).toBe('other');
  expect(api.sessionEvents).not.toHaveBeenCalled();
});

it('分叉完成时当前会话另有管理操作，只刷新来源，不抢占当前会话', async () => {
  let resolve!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const otherSource = { ...source, sessionId: 'other-source' };
  const pending = forkSession('workspace', otherSource, {});
  const operation = { action: 'rename' as const, pending: true };
  useChat.setState((current) => ({ sessionOperations: { ...current.sessionOperations, [key]: operation } }));
  resolve(response());
  expect(await pending).toBe(true);
  expect(useChat.getState().sessionId).toBe('source');
  expect(useChat.getState().sessionOperations[key]).toEqual(operation);
  expect(api.sessionEvents).not.toHaveBeenCalled();
});
