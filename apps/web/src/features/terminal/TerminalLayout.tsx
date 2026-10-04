import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels';
import { TerminalPane } from './TerminalPane';
import { minimumLayoutSize, type TerminalLayoutNode } from './layout';
import { activateTerminalPane, setTerminalPaneStatus, type TerminalTab } from './terminal-store';

type Rects = Record<string, CSSProperties>;
function Slots({
  tree,
  layouts,
  changed,
}: {
  tree: TerminalLayoutNode;
  layouts: Record<string, Layout>;
  changed: (id: string, layout: Layout) => void;
}) {
  if (tree.kind === 'pane') return <div className="h-full w-full" data-terminal-slot={tree.paneId} />;
  const sizes = tree.children.map(minimumLayoutSize);
  return (
    <Group
      orientation={tree.orientation}
      defaultLayout={layouts[tree.id]}
      className="h-full w-full"
      onLayoutChanged={(layout) => changed(tree.id, layout)}
    >
      <Panel
        id={`${tree.id}:0`}
        defaultSize="50%"
        minSize={tree.orientation === 'horizontal' ? sizes[0]!.width : sizes[0]!.height}
      >
        <Slots tree={tree.children[0]} layouts={layouts} changed={changed} />
      </Panel>
      <Separator
        aria-label={tree.orientation === 'horizontal' ? '调整左右终端宽度' : '调整上下终端高度'}
        className={`terminal-separator ${tree.orientation === 'horizontal' ? 'w-1.5' : 'h-1.5'}`}
      />
      <Panel
        id={`${tree.id}:1`}
        defaultSize="50%"
        minSize={tree.orientation === 'horizontal' ? sizes[1]!.width : sizes[1]!.height}
      >
        <Slots tree={tree.children[1]} layouts={layouts} changed={changed} />
      </Panel>
    </Group>
  );
}
export function TerminalLayout({ tab, shown }: { tab: TerminalTab; shown: boolean }) {
  const surface = useRef<HTMLDivElement>(null);
  const [rects, setRects] = useState<Rects>({});
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [layouts, setLayouts] = useState<Record<string, Layout>>({});
  const minimum = tab.tree ? minimumLayoutSize(tab.tree) : { width: 0, height: 0 };
  const compact = size.width < minimum.width || size.height < minimum.height;
  const tree = useMemo(
    () => (compact && tab.activePaneId ? { kind: 'pane' as const, paneId: tab.activePaneId } : tab.tree),
    [compact, tab.activePaneId, tab.tree],
  );
  const changed = useCallback(
    (id: string, layout: Layout) =>
      setLayouts((previous) =>
        JSON.stringify(previous[id]) === JSON.stringify(layout) ? previous : { ...previous, [id]: layout },
      ),
    [],
  );
  useEffect(() => {
    const element = surface.current!;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      setSize((previous) =>
        previous.width === bounds.width && previous.height === bounds.height
          ? previous
          : { width: bounds.width, height: bounds.height },
      );
      const next: Rects = {};
      for (const slot of element.querySelectorAll<HTMLElement>('[data-terminal-slot]')) {
        const box = slot.getBoundingClientRect();
        next[slot.dataset.terminalSlot!] = {
          left: box.left - bounds.left,
          top: box.top - bounds.top,
          width: box.width,
          height: box.height,
        };
      }
      setRects((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    for (const slot of element.querySelectorAll('[data-terminal-slot]')) observer.observe(slot);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [tree, shown]);
  return (
    <div
      ref={surface}
      id={`terminal-surface-${tab.id}`}
      role="tabpanel"
      aria-labelledby={tab.id}
      className="relative min-h-0 min-w-0 flex-1"
      style={{ display: shown ? undefined : 'none' }}
    >
      {tree && (
        <div className="absolute inset-0">
          <Slots tree={tree} layouts={layouts} changed={changed} />
        </div>
      )}
      {tab.panes.map((pane, index) => (
        <TerminalPane
          key={pane.id}
          paneId={pane.id}
          target={pane.target}
          binding={pane.binding}
          visible={shown && !!rects[pane.id] && (!compact || pane.id === tab.activePaneId)}
          active={pane.id === tab.activePaneId}
          style={rects[pane.id] ?? { left: 0, top: 0, width: 0, height: 0 }}
          onState={setTerminalPaneStatus}
          onFocus={activateTerminalPane}
          label={`${tab.name} · 窗格 ${index + 1}`}
        />
      ))}
      {tab.busy && !tab.panes.length && (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          正在绑定终端目标…
        </p>
      )}
    </div>
  );
}
