// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { SessionSummary } from '@agentdeck/shared/conversation';
import { SortableSessionRow } from '../../../src/features/sessions/SortableSessionRow';
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

function SessionRows({ project = 'one' }: { project?: string }) {
  const mode = useSessionOrder((state) => state.mode);
  const order = useSessionOrder((state) => state.orders[project]);
  const sorted = sortSessions(sessions, mode, order);
  return (
    <ul aria-label={`${project} 会话`}>
      {sorted.map((session) => (
        <SortableSessionRow
          key={sessionOrderKey(session)}
          session={session}
          sessions={sorted}
          workspaceId={project}
          active={false}
          select={() => {}}
        />
      ))}
    </ul>
  );
}

function titles(project = 'one') {
  return within(screen.getByRole('list', { name: `${project} 会话` }))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label')?.split(' · ')[0]);
}

function drag(source: HTMLElement, target: HTMLElement) {
  const data = new Map<string, string>();
  const dataTransfer = {
    types: [] as string[],
    setData(type: string, value: string) {
      data.set(type, value);
      this.types.push(type);
    },
    getData: (type: string) => data.get(type) ?? '',
  };
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

beforeEach(() => {
  localStorage.clear();
  useSessionOrder.setState({ mode: 'recent', orders: {}, known: {} });
});
afterEach(cleanup);

it.each([
  { mode: 'recent' as const, source: 'Bravo', target: 'Alpha', expected: ['Bravo', 'Alpha', 'Charlie'] },
  { mode: 'name' as const, source: 'Alpha', target: 'Charlie', expected: ['Bravo', 'Charlie', 'Alpha'] },
  { mode: 'manual' as const, source: 'Bravo', target: 'Alpha', expected: ['Charlie', 'Alpha', 'Bravo'] },
])('$mode 下直接拖动后显示并保存手动顺序', ({ mode, source, target, expected }) => {
  useSessionOrder.setState({ mode, orders: { one: [sessions[0]!, sessions[2]!, sessions[1]!].map(sessionOrderKey) } });
  render(<SessionRows />);
  const from = screen.getByRole('button', { name: new RegExp(`^${source} ·`) });
  const to = screen.getByRole('button', { name: new RegExp(`^${target} ·`) });

  expect(from.closest('li')?.draggable).toBe(true);
  drag(from, to);

  expect(titles()).toEqual(expected);
  const saved = readSessionOrder();
  expect(saved.mode).toBe('manual');
  expect(sortSessions(sessions, saved.mode, saved.orders.one).map((session) => session.title)).toEqual(expected);
});

it.each([
  { mode: 'recent' as const, source: 'Alpha', key: 'ArrowDown', expected: ['Charlie', 'Alpha', 'Bravo'] },
  { mode: 'name' as const, source: 'Charlie', key: 'ArrowUp', expected: ['Alpha', 'Charlie', 'Bravo'] },
  { mode: 'manual' as const, source: 'Alpha', key: 'ArrowUp', expected: ['Bravo', 'Alpha', 'Charlie'] },
])('$mode 下可直接用 Alt 方向键调整顺序且保留焦点', ({ mode, source, key, expected }) => {
  useSessionOrder.setState({ mode, orders: { one: [sessions[0]!, sessions[2]!, sessions[1]!].map(sessionOrderKey) } });
  render(<SessionRows />);
  const button = screen.getByRole('button', { name: new RegExp(`^${source} ·`) });
  button.focus();

  fireEvent.keyDown(button, { key, altKey: true });

  expect(titles()).toEqual(expected);
  expect(readSessionOrder().mode).toBe('manual');
  expect(document.activeElement).toBe(button);
});

it('同名原生身份不能跨项目拖动', () => {
  render(
    <>
      <SessionRows />
      <SessionRows project="two" />
    </>,
  );
  const source = within(screen.getByRole('list', { name: 'one 会话' })).getByRole('button', { name: /^Bravo ·/ });
  const target = within(screen.getByRole('list', { name: 'two 会话' })).getByRole('button', { name: /^Alpha ·/ });

  drag(source, target);

  expect(useSessionOrder.getState().mode).toBe('recent');
  expect(useSessionOrder.getState().orders).toEqual({});
  expect(titles('one')).toEqual(['Alpha', 'Charlie', 'Bravo']);
  expect(titles('two')).toEqual(['Alpha', 'Charlie', 'Bravo']);
});
