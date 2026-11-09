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

it.each([
  { mode: 'recent' as const, expected: ['Charlie', 'Alpha', 'Bravo'] },
  { mode: 'name' as const, expected: ['Bravo', 'Alpha', 'Charlie'] },
])('$mode 下首次移动从当前顺序开始，旧手动顺序不改变其他行', ({ mode, expected }) => {
  const current = sortSessions(sessions, mode).map(sessionOrderKey);
  useSessionOrder.setState({ mode, orders: { one: current.toReversed() } });
  useSessionOrder.getState().remember('one', current, false);

  useSessionOrder.getState().move('one', current[0]!, current[1]!, current);

  const saved = readSessionOrder();
  expect(saved.mode).toBe('manual');
  expect(sortSessions(sessions, saved.mode, saved.orders.one).map((session) => session.title)).toEqual(expected);
});

it.each([
  { source: 'a', target: 'd', expected: ['b', 'c', 'd', 'a', 'unloaded'] },
  { source: 'd', target: 'a', expected: ['d', 'a', 'b', 'c', 'unloaded'] },
])('搜索中将 $source 移至 $target 时保留当前完整顺序与其他项目', ({ source, target, expected }) => {
  useSessionOrder.setState({ mode: 'name', orders: { one: ['d', 'c', 'b', 'a', 'unloaded'], two: ['other'] } });
  useSessionOrder.getState().remember('one', ['a', 'b', 'c', 'd'], false);
  useSessionOrder.getState().remember('one', ['a', 'd'], true);

  useSessionOrder.getState().move('one', source, target, ['a', 'd']);

  expect(readSessionOrder().orders).toEqual({ one: expected, two: ['other'] });
});

it('切换排序后调整已加载身份，分页外身份保留在已有间隔', () => {
  useSessionOrder.setState({ mode: 'recent', orders: { one: ['a', 'unloaded', 'b', 'c'] } });
  useSessionOrder.getState().remember('one', ['c', 'b', 'a'], false);

  useSessionOrder.getState().move('one', 'a', 'b', ['c', 'b', 'a']);

  expect(readSessionOrder().orders.one).toEqual(['c', 'unloaded', 'a', 'b']);
});

it('搜索返回的当前顺序会更新记忆，未显示身份的相对顺序保留', () => {
  useSessionOrder.getState().remember('one', ['a', 'b', 'c', 'd'], false);
  useSessionOrder.getState().remember('one', ['d', 'a'], true);

  expect(useSessionOrder.getState().known.one).toEqual(['d', 'b', 'c', 'a']);
  useSessionOrder.getState().move('one', 'd', 'a', ['d', 'a']);
  expect(readSessionOrder().orders.one).toEqual(['b', 'c', 'a', 'd']);
});
