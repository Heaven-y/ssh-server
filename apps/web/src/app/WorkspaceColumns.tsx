import { useLayoutEffect, type ReactNode } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { useUiPreferences, type UiWidthKey } from '../ui/ui-preferences';

/**
 * 右侧上下文面板按需打开，关闭不重建中间对话。
 * 默认 420px，可调 300–720px，收起时不占宽度（见 ui-layout 1.1）。
 */
export function dockSizing(): { key: UiWidthKey; min: number; max: number } {
  return { key: 'rightWidth', min: 300, max: 720 };
}

export function WorkspaceColumns({
  children,
  chatMin,
  dock,
  dockOpen = false,
}: {
  children: ReactNode;
  chatMin: number;
  dock?: ReactNode;
  dockOpen?: boolean;
}) {
  const panel = usePanelRef();
  const sizing = dockSizing();
  const width = useUiPreferences((state) => state[sizing.key]);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (dockOpen) panel.current?.resize(width);
      else panel.current?.collapse();
    });
    return () => cancelAnimationFrame(frame);
  }, [dockOpen, panel, width, sizing.key]);
  return (
    <Group
      orientation="horizontal"
      id="workspace-columns"
      className="h-full min-h-0 min-w-0"
      onLayoutChanged={(_layout, meta) => {
        if (meta.isUserInteraction && dockOpen && panel.current)
          useUiPreferences.getState().setWidth(sizing.key, panel.current.getSize().inPixels);
      }}
    >
      <Panel id="workspace-conversation" minSize={chatMin}>
        <div className="flex h-full min-h-0 min-w-0">{children}</div>
      </Panel>
      <Separator
        aria-label="调整右侧边栏宽度"
        disabled={!dockOpen}
        hidden={!dockOpen}
        className={`workspace-separator ${dockOpen ? 'w-px' : 'hidden'}`}
      />
      <Panel
        id="workspace-context-sidebar"
        panelRef={panel}
        defaultSize={dockOpen ? width : 0}
        groupResizeBehavior="preserve-pixel-size"
        minSize={dockOpen ? sizing.min : 0}
        maxSize={dockOpen ? sizing.max : 0}
        collapsible={!dockOpen}
        collapsedSize={0}
      >
        <div className="h-full min-h-0 min-w-0" hidden={!dockOpen} inert={!dockOpen}>
          {dock}
        </div>
      </Panel>
    </Group>
  );
}
