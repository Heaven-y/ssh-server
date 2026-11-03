import { type ReactNode } from 'react';
import { isBoundWorkspace, terminalTargetKey, workspaceTerminalTarget, type Workspace } from '@agentdeck/shared';
import { ResourcesPanel } from '../features/resources/ResourcesPanel';
import { WorkspacePanelFrame } from './WorkspacePanelFrame';
import { WorkspaceLayout } from './WorkspaceLayout';

/**
 * 本地文件镜像与差异面板已删除；这里只保留资源停靠。
 * 外壳的正式重写在后续任务完成，当前阶段只保证对话与资源可用。
 */
export function WorkspacePanels({
  navigation,
  children,
  resourcesOpen,
  workspace,
  hideResources,
}: {
  navigation: ReactNode;
  children: ReactNode;
  resourcesOpen: boolean;
  workspace?: Workspace;
  hideResources(): void;
}) {
  // 资源面板以服务器为身份：只有绑定了服务器与默认目录的项目才渲染。
  const bound = workspace && isBoundWorkspace(workspace) ? workspace : undefined;
  return (
    <WorkspaceLayout
      navigation={navigation}
      resourcesOpen={resourcesOpen}
      resources={
        <WorkspacePanelFrame kind="resources" opened={resourcesOpen} hide={hideResources}>
          {bound && (
            <ResourcesPanel
              key={terminalTargetKey(workspaceTerminalTarget(bound))}
              workspace={bound}
              active={resourcesOpen}
            />
          )}
        </WorkspacePanelFrame>
      }
    >
      {children}
    </WorkspaceLayout>
  );
}
