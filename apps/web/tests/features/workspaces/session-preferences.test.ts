// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sessionActionKey } from '../../../src/features/chat/chat-store';
import {
  readSessionPins,
  SESSION_PINS_KEY,
  useSessionPins,
} from '../../../src/features/workspaces/session-preferences';

const session = { agent: 'codex' as const, sessionId: 'same-native-id' };
beforeEach(() => {
  localStorage.clear();
  useSessionPins.setState({ pins: [] });
});
afterEach(() => vi.restoreAllMocks());

it('置顶按工作区、Agent与会话隔离，持久化只有排序标识', () => {
  useSessionPins.getState().toggle('workspace', session);
  expect(useSessionPins.getState().pins).toEqual([sessionActionKey('workspace', session)]);
  expect(useSessionPins.getState().pins).not.toContain(sessionActionKey('other', session));
  expect(useSessionPins.getState().pins).not.toContain(sessionActionKey('workspace', { ...session, agent: 'claude' }));
  expect(readSessionPins()).toEqual(useSessionPins.getState().pins);
  expect(JSON.parse(localStorage.getItem(SESSION_PINS_KEY)!)).toEqual({
    version: 1,
    pins: [sessionActionKey('workspace', session)],
  });
  useSessionPins.getState().toggle('workspace', { ...session, agent: 'claude' });
  useSessionPins.getState().toggle('workspace', session);
  expect(readSessionPins()).toEqual([sessionActionKey('workspace', { ...session, agent: 'claude' })]);
});

it('损坏或不可访问的存储不阻塞使用，恢复时过滤非法与重复条目', () => {
  const key = sessionActionKey('workspace', session);
  localStorage.setItem(SESSION_PINS_KEY, JSON.stringify({ version: 1, pins: [key, 'bad', key, 12] }));
  expect(readSessionPins()).toEqual([key]);
  localStorage.setItem(SESSION_PINS_KEY, '{');
  expect(readSessionPins()).toEqual([]);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('禁用存储');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('禁用存储');
  });
  expect(readSessionPins()).toEqual([]);
  expect(() => useSessionPins.getState().toggle('workspace', session)).not.toThrow();
  expect(useSessionPins.getState().pins).toContain(key);
});
