import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import type { Workspace } from '@ssh-server/shared';

const TerminalDock = lazy(() => import('../features/terminal/TerminalDock'));

/** 主区的分栏始终存在；首次打开后终端保持挂载，覆盖层也沿用同一子树。 */
export function WorkspaceArea({
  children,
  workspace,
  terminalLoaded,
  terminalVisible,
  onHideTerminal,
}: {
  children: ReactNode;
  workspace?: Workspace;
  terminalLoaded: boolean;
  terminalVisible: boolean;
  onHideTerminal: () => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const terminalPanel = usePanelRef();
  const [overlay, setOverlay] = useState(false);
  const savedSize = useRef('40%');
  useEffect(() => {
    const element = area.current!;
    const observer = new ResizeObserver(([entry]) => setOverlay(entry!.contentRect.height < 480));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const panel = terminalPanel.current;
    if (!panel) return;
    if (terminalVisible && !overlay) panel.resize(savedSize.current);
    else panel.collapse();
  }, [terminalVisible, overlay, terminalPanel]);
  return (
    <div ref={area} className="min-h-0 min-w-0 flex-1">
      <Group orientation="vertical" className="h-full w-full">
        <Panel id="workspace-main" defaultSize="100%" minSize={overlay ? 0 : 240}>
          <div className="flex h-full min-h-0 min-w-0">{children}</div>
        </Panel>
        <Separator
          aria-label="调整终端高度"
          className={`terminal-separator ${terminalVisible && !overlay ? 'h-1.5' : 'hidden'}`}
        />
        <Panel
          id="workspace-terminal"
          panelRef={terminalPanel}
          collapsible
          collapsedSize={0}
          defaultSize={0}
          minSize={240}
          onResize={(size) => {
            if (size.inPixels >= 240) savedSize.current = `${size.asPercentage}%`;
          }}
        >
          {terminalLoaded && (
            <Suspense
              fallback={
                <p role="status" className="p-4 text-sm">
                  正在打开终端…
                </p>
              }
            >
              <TerminalDock workspace={workspace} visible={terminalVisible} overlay={overlay} onHide={onHideTerminal} />
            </Suspense>
          )}
        </Panel>
      </Group>
    </div>
  );
}
