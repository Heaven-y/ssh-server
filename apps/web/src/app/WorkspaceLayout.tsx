import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { useUiPreferences } from '../ui/ui-preferences';
import { useMinWidth } from './use-min-width';
import { dockSizing, WorkspaceColumns } from './WorkspaceColumns';

export type WorkspaceLayoutProps = {
  /** 左栏：项目与会话。 */
  navigation: ReactNode;
  /** 主区：会话。 */
  children: ReactNode;
  /** 右侧服务器面板；收起时只隐藏，不卸载。 */
  dock?: ReactNode;
  dockOpen?: boolean;
};

/**
 * 三段式外壳：左栏 200–320px 可收起、主区最小 480px、右侧服务器面板可收起。
 * 宽度约束接进 Panel 本身，偏好只存内存与有界值（见 ui-preferences）。
 */
export function WorkspaceLayout({ navigation, children, dock, dockOpen = false }: WorkspaceLayoutProps) {
  const panel = usePanelRef();
  const compact = !useMinWidth(1280);
  const collapsed = useUiPreferences((state) => state.sidebarCollapsed || state.sidebarAutoCollapsed);
  const width = useUiPreferences((state) => state.sidebarWidth);
  // 窄屏默认让出空间；用户主动展开左栏时允许较紧凑的对话，右侧面板此时必须收起。
  const chatMin = compact && !collapsed ? 320 : 480;
  const contentMin = chatMin + (dockOpen ? dockSizing().min + 6 : 0);
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
        <WorkspaceColumns chatMin={chatMin} dock={dock} dockOpen={dockOpen}>
          {children}
        </WorkspaceColumns>
      </Panel>
    </Group>
  );
}
