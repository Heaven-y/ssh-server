import { useLayoutEffect, type ReactNode } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { useUiPreferences } from '../ui/ui-preferences';

export function WorkspaceLayout({ navigation, children }: { navigation: ReactNode; children: ReactNode }) {
  const panel = usePanelRef();
  const collapsed = useUiPreferences((state) => state.sidebarCollapsed);
  const width = useUiPreferences((state) => state.sidebarWidth);
  useLayoutEffect(() => {
    if (collapsed) panel.current?.collapse();
    else panel.current?.resize(width);
  }, [collapsed, width, panel]);
  return (
    <Group
      orientation="horizontal"
      className="min-h-0 flex-1"
      onLayoutChanged={(_layout, meta) => {
        if (!meta.isUserInteraction || !panel.current) return;
        const size = panel.current.getSize().inPixels;
        const preferences = useUiPreferences.getState();
        preferences.setSidebarCollapsed(size === 0);
        preferences.setWidth('sidebarWidth', size);
      }}
    >
      <Panel
        id="workspace-navigation"
        panelRef={panel}
        defaultSize={collapsed ? 0 : width}
        minSize={200}
        maxSize={320}
        collapsible
        collapsedSize={0}
      >
        <div className="h-full" inert={collapsed} aria-hidden={collapsed}>
          {navigation}
        </div>
      </Panel>
      <Separator aria-label="调整侧栏宽度" className={`workspace-separator ${collapsed ? 'hidden' : 'w-1.5'}`} />
      <Panel id="workspace-content" minSize={400}>
        <div className="flex h-full min-h-0 min-w-0">{children}</div>
      </Panel>
    </Group>
  );
}
