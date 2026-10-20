import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels';
import { useUiPreferences } from '../ui/ui-preferences';

export type WorkspaceToolsProps = {
  resources?: ReactNode;
  files?: ReactNode;
  resourcesOpen: boolean;
  filesOpen: boolean;
  horizontal: boolean;
};
const AXES = {
  horizontal: {
    orientation: 'horizontal',
    key: 'resourceShare',
    resourceMin: 280,
    fileMin: 360,
    size: 'w-1.5',
    label: '调整资源与文件宽度',
  },
  vertical: {
    orientation: 'vertical',
    key: 'resourceHeight',
    resourceMin: 128,
    fileMin: 200,
    size: 'h-1.5',
    label: '调整资源与文件高度',
  },
} as const;
function resourceShare(resources: boolean, files: boolean, ratio: number) {
  if (!files) return 100;
  return resources ? ratio : 0;
}
function limits(opened: boolean, minimum: number, constrainHidden = true) {
  return {
    minSize: opened ? minimum : 0,
    maxSize: opened || !constrainHidden ? undefined : 0,
    collapsible: !opened,
    collapsedSize: 0,
  };
}
/** 方向变化只更新同一个Group，已打开文件子树和资源控制器始终保留父子关系。 */
export function WorkspaceTools({ resources, files, resourcesOpen, filesOpen, horizontal }: WorkspaceToolsProps) {
  const group = useGroupRef();
  const element = useRef<HTMLDivElement>(null);
  const axis = AXES[horizontal ? 'horizontal' : 'vertical'];
  const ratio = useUiPreferences((state) => state[axis.key]);
  const both = resourcesOpen && filesOpen;
  const splitLimit = both ? { maxSize: '80%' } : {};
  const share = resourceShare(resourcesOpen, filesOpen, ratio);
  useLayoutEffect(() => {
    let frame = 0;
    const restore = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        group.current?.setLayout({ 'resources-column': share, 'files-column': 100 - share });
      });
    };
    // 等嵌套分屏的尺寸观察器更新约束，避免按上一帧隐藏栏的尺寸夹紧当前比例。
    const observer = new ResizeObserver(restore);
    if (element.current) observer.observe(element.current);
    restore();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [group, share, horizontal]);
  return (
    <Group
      id="workspace-tools"
      groupRef={group}
      elementRef={element}
      orientation={axis.orientation}
      className="h-full min-h-0 min-w-0"
      onLayoutChanged={(layout, meta) => {
        if (meta.isUserInteraction && both) useUiPreferences.getState().setSplit(axis.key, layout['resources-column']!);
      }}
    >
      <Panel
        id="resources-column"
        defaultSize={`${share}%`}
        {...limits(resourcesOpen, axis.resourceMin, filesOpen)}
        {...splitLimit}
      >
        <div className="h-full min-h-0 min-w-0" hidden={!resourcesOpen} inert={!resourcesOpen}>
          {resources}
        </div>
      </Panel>
      <Separator
        aria-label={axis.label}
        disabled={!both}
        hidden={!both}
        className={`workspace-separator ${both ? axis.size : 'hidden'}`}
      />
      <Panel id="files-column" defaultSize={`${100 - share}%`} {...limits(filesOpen, axis.fileMin)} {...splitLimit}>
        <div className="h-full min-h-0 min-w-0" hidden={!filesOpen} inert={!filesOpen}>
          {files}
        </div>
      </Panel>
    </Group>
  );
}
