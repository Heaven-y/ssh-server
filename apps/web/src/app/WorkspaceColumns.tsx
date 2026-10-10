import { useLayoutEffect, type ReactNode } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { useUiPreferences, type UiWidthKey } from '../ui/ui-preferences';
import { WorkspaceTools, type WorkspaceToolsProps } from './WorkspaceTools';

export function toolSizing(
  horizontal: boolean,
  resources: boolean,
  files: boolean,
): { key: UiWidthKey; min: number; max: number } {
  if (!horizontal) return { key: 'rightWidth', min: 360, max: 720 };
  if (resources && files) return { key: 'wideToolsWidth', min: 646, max: 1400 };
  return resources ? { key: 'resourceWidth', min: 280, max: 640 } : { key: 'fileWidth', min: 360, max: 960 };
}
export function WorkspaceColumns({
  children,
  chatMin,
  ...tools
}: WorkspaceToolsProps & { children: ReactNode; chatMin: number }) {
  const panel = usePanelRef();
  const opened = tools.resourcesOpen || tools.filesOpen;
  const sizing = toolSizing(tools.horizontal, tools.resourcesOpen, tools.filesOpen);
  const width = useUiPreferences((state) => state[sizing.key]);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (opened) panel.current?.resize(width);
      else panel.current?.collapse();
    });
    return () => cancelAnimationFrame(frame);
  }, [opened, panel, width, sizing.key]);
  return (
    <Group
      orientation="horizontal"
      id="workspace-columns"
      className="h-full min-h-0 min-w-0"
      onLayoutChanged={(_layout, meta) => {
        if (meta.isUserInteraction && opened && panel.current)
          useUiPreferences.getState().setWidth(sizing.key, panel.current.getSize().inPixels);
      }}
    >
      <Panel id="workspace-conversation" minSize={chatMin}>
        <div className="flex h-full min-h-0 min-w-0">{children}</div>
      </Panel>
      <Separator
        aria-label="调整工具区宽度"
        disabled={!opened}
        hidden={!opened}
        className={`workspace-separator ${opened ? 'w-1.5' : 'hidden'}`}
      />
      <Panel
        id="workspace-tool-area"
        panelRef={panel}
        defaultSize={opened ? width : 0}
        groupResizeBehavior="preserve-pixel-size"
        minSize={opened ? sizing.min : 0}
        maxSize={opened ? sizing.max : 0}
        collapsible={!opened}
        collapsedSize={0}
      >
        <div className="h-full min-h-0 min-w-0" hidden={!opened} inert={!opened}>
          <WorkspaceTools {...tools} />
        </div>
      </Panel>
    </Group>
  );
}
