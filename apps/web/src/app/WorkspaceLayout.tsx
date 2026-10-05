import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { useUiPreferences } from '../ui/ui-preferences';

export function useWideWorkspace() {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1280px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)');
    const changed = () => setWide(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  return wide;
}
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
export function WorkspaceColumns({
  children,
  files,
  opened,
}: {
  children: ReactNode;
  files: ReactNode;
  opened: boolean;
}) {
  const panel = usePanelRef();
  const wide = useWideWorkspace();
  const width = useUiPreferences((state) => state.fileWidth);
  const visible = opened && wide;
  // 以有界尺寸切换分栏；关闭和窄窗时上下限均为零，文件子树仍可作为原生覆盖层显示。
  useEffect(() => {
    // Group应用新上下限后再恢复偏好，避免打开时resize被上一轮maxSize=0截断。
    const frame = requestAnimationFrame(() => panel.current?.resize(visible ? width : 0));
    return () => cancelAnimationFrame(frame);
  }, [visible, width, panel]);
  return (
    <Group
      orientation="horizontal"
      className="h-full min-w-0 flex-1"
      onLayoutChanged={(_layout, meta) => {
        if (meta.isUserInteraction && panel.current)
          useUiPreferences.getState().setWidth('fileWidth', panel.current.getSize().inPixels);
      }}
    >
      <Panel id="workspace-conversation" minSize={wide ? 400 : 0}>
        <div className="flex h-full min-h-0 min-w-0">{children}</div>
      </Panel>
      <Separator aria-label="调整文件面板宽度" className={`workspace-separator ${visible ? 'w-1.5' : 'hidden'}`} />
      <Panel
        id="workspace-files"
        panelRef={panel}
        // 用户拖动保留最小可用宽度；关闭仍经过文件面板已有的未保存确认。
        defaultSize={0}
        minSize={visible ? 360 : 0}
        maxSize={visible ? 520 : 0}
      >
        <div className="h-full">{files}</div>
      </Panel>
    </Group>
  );
}
