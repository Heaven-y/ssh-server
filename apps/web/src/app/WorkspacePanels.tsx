import { type ReactNode } from 'react';
import { terminalTargetKey, workspaceTerminalTarget, type Workspace } from '@agentdeck/shared';
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
  return (
    <WorkspaceLayout
      navigation={navigation}
      resourcesOpen={resourcesOpen}
      resources={
        <WorkspacePanelFrame kind="resources" opened={resourcesOpen} hide={hideResources}>
          {workspace && (
            <ResourcesPanel
              key={terminalTargetKey(workspaceTerminalTarget(workspace))}
              workspace={workspace}
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
