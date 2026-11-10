import { useEffect, useRef, useState } from 'react';
import type { useConsoleTerminals } from './use-console-terminals';

type Direction = 'horizontal' | 'vertical';
type Layout = { panes: string[]; focused?: string; direction?: Direction };
type Terminals = ReturnType<typeof useConsoleTerminals>;
function survivingPanes(state: Terminals, layout: Layout) {
  const ids = state.terminals.map((item) => item.id);
  const live = layout.panes.filter((id) => ids.includes(id));
  if (live.length) return live;
  const fallback = ids.find((id) => id === state.selected) ?? ids[0];
  return fallback ? [fallback] : [];
}

export function useConsolePanes(state: Terminals) {
  const [layout, setLayout] = useState<Layout>({ panes: [] });
  const revision = useRef(0);
  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );
  const shown = survivingPanes(state, layout);
  const focused = shown.find((id) => id === layout.focused) ?? shown[0];
  const show = (id: string) => {
    revision.current++;
    const panes = [...shown];
    if (!panes.includes(id)) panes[Math.max(0, panes.indexOf(focused ?? ''))] = id;
    setLayout({ ...layout, panes, focused: id });
  };
  const focus = (id: string) => {
    if (id === focused) return;
    revision.current++;
    setLayout({ ...layout, panes: shown, focused: id });
  };
  const create = async () => {
    const version = ++revision.current;
    const terminal = await state.create();
    if (terminal && revision.current === version) setLayout({ panes: [terminal.id], focused: terminal.id });
  };
  const split = async (direction: Direction) => {
    const first = shown[0];
    if (!first || state.busy) return;
    const version = ++revision.current;
    if (shown.length > 1) {
      setLayout({ panes: shown, focused, direction });
      return;
    }
    const spare = state.terminals.find((item) => item.id !== first) ?? (await state.create());
    if (spare && revision.current === version) setLayout({ panes: [first, spare.id], focused: spare.id, direction });
  };
  const unsplit = () => {
    revision.current++;
    setLayout({ panes: focused ? [focused] : [], focused });
  };
  return {
    shown,
    focused,
    direction: shown.length > 1 ? layout.direction : undefined,
    show,
    focus,
    create,
    split,
    unsplit,
  };
}
