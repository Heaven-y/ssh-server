import { lazy, Suspense } from 'react';
import { terminalTargetKey, workspaceTerminalTarget, type Workspace } from '@ssh-server/shared';
import { ResourcesPanel } from '../features/resources/ResourcesPanel';
import type { ChangesRequest } from '../features/changes/types';
import type { WorkspacePanelKind } from './floating-panel-geometry';
import { WorkspacePanelFrame } from './WorkspacePanelFrame';

const FilesPanel = lazy(() => import('../features/files/FilesPanel'));

export function WorkspacePanels({
  resourcesOpen,
  filesOpen,
  front,
  workspace,
  filesWorkspace,
  changesRequest,
  activate,
  hide,
  closeFiles,
}: {
  resourcesOpen: boolean;
  filesOpen: boolean;
  front: WorkspacePanelKind;
  workspace?: Workspace;
  filesWorkspace?: Workspace;
  changesRequest?: ChangesRequest;
  activate(kind: WorkspacePanelKind): void;
  hide(kind: WorkspacePanelKind): void;
  closeFiles(): void;
}) {
  return (
    <>
      <WorkspacePanelFrame
        kind="resources"
        opened={resourcesOpen}
        front={front === 'resources'}
        onActivate={() => activate('resources')}
        hide={() => hide('resources')}
      >
        {workspace && (
          <ResourcesPanel
            key={terminalTargetKey(workspaceTerminalTarget(workspace))}
            workspace={workspace}
            active={resourcesOpen}
          />
        )}
      </WorkspacePanelFrame>
      <WorkspacePanelFrame
        kind="files"
        opened={filesOpen}
        front={front === 'files'}
        onActivate={() => activate('files')}
        hide={() => hide('files')}
      >
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
    </>
  );
}
