// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import type { SessionSummary } from '@agentdeck/shared/conversation';
import {
  readSessionOrder,
  sessionOrderKey,
  sortSessions,
  useSessionOrder,
} from '../../../src/features/sessions/session-order';

const sessions: SessionSummary[] = [
  {
    agent: 'claude',
    sessionId: 'shared',
    title: 'Bravo',
    projectId: 'one',
    running: false,
    updatedAt: new Date(1).toISOString(),
  },
  {
    agent: 'codex',
    sessionId: 'shared',
    title: 'Alpha',
    projectId: 'one',
    running: false,
    updatedAt: new Date(3).toISOString(),
  },
  {
    agent: 'antigravity',
    sessionId: 'last',
    title: 'Charlie',
    projectId: 'one',
    running: false,
    updatedAt: new Date(2).toISOString(),
  },
];
beforeEach(() => {
  localStorage.clear();
  useSessionOrder.setState({ mode: 'recent', orders: {}, known: {} });
});

it('按时间或名称排序，手动顺序保存跨 CLI 的完整身份并可恢复', () => {
  const recent = sortSessions(sessions, 'recent');
  expect(recent.map((entry) => entry.title)).toEqual(['Alpha', 'Charlie', 'Bravo']);
  expect(sortSessions(sessions, 'name').map((entry) => entry.title)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  const keys = recent.map(sessionOrderKey);
  useSessionOrder.getState().move('one', keys[2]!, keys[0]!, keys);
  const saved = readSessionOrder();
  expect(saved.mode).toBe('manual');
  expect(sortSessions(sessions, saved.mode, saved.orders.one).map((entry) => entry.title)).toEqual([
    'Bravo',
    'Alpha',
    'Charlie',
  ]);
});

it('过滤或分页后移动可见条目时保留未加载身份，其他项目和外来条目不受影响', () => {
  const keys = sessions.map(sessionOrderKey);
  useSessionOrder.setState({ mode: 'manual', orders: { one: keys, two: ['unchanged'] } });
  useSessionOrder.getState().move('one', keys[2]!, keys[1]!, keys.slice(1));
  expect(useSessionOrder.getState().orders).toEqual({ one: [keys[0], keys[2], keys[1]], two: ['unchanged'] });
  useSessionOrder.getState().move('one', 'external', keys[0]!, keys);
  expect(useSessionOrder.getState().orders.one).toEqual([keys[0], keys[2], keys[1]]);
});

it('首次在搜索结果中手动移动时沿用此前完整列表的顺序', () => {
  const order = ['a', 'b', 'c', 'd'];
  useSessionOrder.getState().remember('one', order, false);
  useSessionOrder.getState().remember('one', ['a', 'd'], true);
  useSessionOrder.getState().move('one', 'a', 'd', ['a', 'd']);
  expect(useSessionOrder.getState().orders.one).toEqual(['b', 'c', 'd', 'a']);
});

it('已有手动顺序也保留后来加载的条目，搜索中移动不把它们挤到末尾', () => {
  useSessionOrder.setState({ mode: 'manual', orders: { one: ['a', 'b'] }, known: { one: ['a', 'b', 'c', 'd'] } });
  useSessionOrder.getState().move('one', 'a', 'd', ['a', 'd']);
  expect(useSessionOrder.getState().orders.one).toEqual(['b', 'c', 'd', 'a']);
});
