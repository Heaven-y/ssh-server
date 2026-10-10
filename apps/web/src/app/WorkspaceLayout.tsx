import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { useUiPreferences } from '../ui/ui-preferences';
import { useMinWidth } from './use-min-width';
import { toolSizing, WorkspaceColumns } from './WorkspaceColumns';

export type WorkspaceLayoutProps = {
  navigation: ReactNode;
  children: ReactNode;
  resources?: ReactNode;
  files?: ReactNode;
  resourcesOpen?: boolean;
  filesOpen?: boolean;
};
export function WorkspaceLayout({
  navigation,
  children,
  resources,
  files,
  resourcesOpen = false,
  filesOpen = false,
}: WorkspaceLayoutProps) {
  const panel = usePanelRef();
  const horizontal = useMinWidth(1600);
  const compact = !useMinWidth(1280);
  const collapsed = useUiPreferences((state) => state.sidebarCollapsed || state.sidebarAutoCollapsed);
  const width = useUiPreferences((state) => state.sidebarWidth);
  const toolsOpen = resourcesOpen || filesOpen;
  // 窄屏默认让出空间；用户主动展开时允许较紧凑的对话，不禁止工作区导航。
  const chatMin = compact && !collapsed ? 320 : 480;
  const contentMin = chatMin + (toolsOpen ? toolSizing(horizontal, resourcesOpen, filesOpen).min + 6 : 0);
  useEffect(() => {
    useUiPreferences.getState().setSidebarAutoCollapsed(compact);
  }, [compact]);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (collapsed) panel.current?.collapse();
      else panel.current?.resize(width);
    });
    return () => cancelAnimationFrame(frame);
  }, [collapsed, width, panel]);
  return (
    <Group
      orientation="horizontal"
      id="workspace-layout"
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
        groupResizeBehavior="preserve-pixel-size"
        minSize={200}
        maxSize={320}
        collapsible
        collapsedSize={0}
      >
        <div className="h-full" hidden={collapsed} inert={collapsed}>
          {navigation}
        </div>
      </Panel>
      <Separator
        aria-label="调整侧栏宽度"
        hidden={collapsed}
        disabled={collapsed}
        className={`workspace-separator ${collapsed ? 'hidden' : 'w-1.5'}`}
      />
      <Panel id="workspace-content" minSize={contentMin}>
        <WorkspaceColumns
          chatMin={chatMin}
          horizontal={horizontal}
          resources={resources}
          files={files}
          resourcesOpen={resourcesOpen}
          filesOpen={filesOpen}
        >
          {children}
        </WorkspaceColumns>
      </Panel>
    </Group>
  );
}
