import { lazy, Suspense, type ReactNode } from 'react';
import { terminalTargetKey, workspaceTerminalTarget, type Workspace } from '@ssh-server/shared';
import { ResourcesPanel } from '../features/resources/ResourcesPanel';
import type { ChangesRequest } from '../features/changes/types';
import { WorkspacePanelFrame, type WorkspacePanelKind } from './WorkspacePanelFrame';
import { WorkspaceLayout } from './WorkspaceLayout';

const FilesPanel = lazy(() => import('../features/files/FilesPanel'));
export function WorkspacePanels({
  navigation,
  children,
  resourcesOpen,
  filesOpen,
  workspace,
  filesWorkspace,
  changesRequest,
  hide,
  closeFiles,
}: {
  navigation: ReactNode;
  children: ReactNode;
  resourcesOpen: boolean;
  filesOpen: boolean;
  workspace?: Workspace;
  filesWorkspace?: Workspace;
  changesRequest?: ChangesRequest;
  hide(kind: WorkspacePanelKind): void;
  closeFiles(): void;
}) {
  return (
    <WorkspaceLayout
      navigation={navigation}
      resourcesOpen={resourcesOpen}
      filesOpen={filesOpen}
      resources={
        <WorkspacePanelFrame kind="resources" opened={resourcesOpen} hide={() => hide('resources')}>
          {workspace && (
            <ResourcesPanel
              key={terminalTargetKey(workspaceTerminalTarget(workspace))}
              workspace={workspace}
              active={resourcesOpen}
            />
          )}
        </WorkspacePanelFrame>
      }
      files={
        <WorkspacePanelFrame kind="files" opened={filesOpen} hide={() => hide('files')}>
          {filesWorkspace && (
            <Suspense
              fallback={
                <p role="status" className="p-4 text-sm">
                  正在打开文件…
                </p>
              }
            >
              <FilesPanel
                key={filesWorkspace.id}
                workspace={filesWorkspace}
                active={filesOpen}
                changesRequest={changesRequest}
                onClose={closeFiles}
              />
            </Suspense>
          )}
        </WorkspacePanelFrame>
      }
    >
      {children}
    </WorkspaceLayout>
  );
}
