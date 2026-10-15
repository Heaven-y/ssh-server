import { lazy, Suspense, useId, useState } from 'react';
import { FileCode2, FileDiff, Server, X } from 'lucide-react';
import type { Workspace } from '@ssh-server/shared';
import { FilePreview } from './FilePreview';
import { buttonClass } from '../../ui/styles';
import { FileDirectory } from './FileDirectory';
import { useFilePreview } from './use-file-preview';
import { RemoteFilesPanel } from '../remote-files/RemoteFilesPanel';
import { useChat } from '../chat/chat-store';
import type { ChangesRequest } from '../changes/types';

const ChangesPanel = lazy(() => import('../changes/ChangesPanel'));
type FileView = 'local' | 'remote' | 'changes';

function useFileView(workspace: Workspace, changesRequest?: ChangesRequest) {
  const conversationVersion = useChat((state) => state.conversationVersion);
  const workspaceId = useChat((state) => state.workspaceId);
  const agent = useChat((state) => state.agent);
  const request =
    changesRequest?.workspaceId === workspace.id &&
    workspaceId === workspace.id &&
    changesRequest.agent === agent &&
    changesRequest.conversationVersion === conversationVersion
      ? changesRequest
      : undefined;
  const [chosen, choose] = useState<{ view: FileView; nonce?: string }>({ view: 'local' });
  const [loaded, setLoaded] = useState(false);
  const view = request && request.nonce !== chosen.nonce ? 'changes' : chosen.view;
  const setView = (next: FileView) => {
    choose({ view: next, nonce: request?.nonce });
    if (next === 'changes') setLoaded(true);
  };
  return { view, setView, loaded, request, conversationVersion };
}

function ChangesArea({
  id,
  workspace,
  fileView,
  active,
}: {
  id: string;
  workspace: Workspace;
  fileView: ReturnType<typeof useFileView>;
  active: boolean;
}) {
  return (
    <div
      id={`${id}-changes`}
      hidden={fileView.view !== 'changes'}
      className={fileView.view === 'changes' ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}
    >
      {(fileView.loaded || fileView.request) && (
        <Suspense
          fallback={
            <p role="status" className="p-3 text-xs">
              正在打开改动…
            </p>
          }
        >
          <ChangesPanel
            key={fileView.conversationVersion}
            workspace={workspace}
            active={active && fileView.view === 'changes'}
            request={fileView.request}
          />
        </Suspense>
      )}
    </div>
  );
}

/** 面板绑定打开时的工作区；切换对话工作区不会迁移已打开的文件。 */
export default function FilesPanel({
  workspace: initialWorkspace,
  onClose,
  changesRequest,
  active,
}: {
  workspace: Workspace;
  onClose(): void;
  changesRequest?: ChangesRequest;
  active: boolean;
}) {
  const id = useId();
  const [workspace] = useState(initialWorkspace);
  const fileView = useFileView(workspace, changesRequest);
  const { view, setView } = fileView;
  const preview = useFilePreview(workspace.id);
  return (
    <section
      aria-label="工作区文件"
      hidden={!active}
      inert={!active}
      className={active ? 'flex h-full min-h-0 flex-1 flex-col' : 'hidden'}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">工作区：{workspace.name}</p>
        <button
          type="button"
          className={buttonClass('ghost')}
          aria-label="关闭文件面板"
          title="关闭文件面板"
          onClick={onClose}
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>
      <FileViewSelector id={id} view={view} setView={setView} />
      <section
        id={`${id}-local`}
        aria-label="本地代码"
        hidden={view !== 'local'}
        className={view === 'local' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
      >
        <FileDirectory
          workspaceId={workspace.id}
          disabled={preview.busy}
          active={active && view === 'local'}
          openFile={(relative) => {
            void preview.open(relative);
          }}
        />
        <FilePreview preview={preview} disabled={preview.busy} />
      </section>
      <div
        id={`${id}-remote`}
        hidden={view !== 'remote'}
        className={view === 'remote' ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}
      >
        <RemoteFilesPanel workspace={workspace} active={active && view === 'remote'} />
      </div>
      <ChangesArea id={id} workspace={workspace} fileView={fileView} active={active} />
    </section>
  );
}

function FileViewSelector({ id, view, setView }: { id: string; view: FileView; setView(view: FileView): void }) {
  return (
    <div role="group" aria-label="文件视图" className="flex shrink-0 flex-wrap gap-1 border-b border-border px-3 py-2">
      <button
        type="button"
        className={buttonClass(view === 'local' ? 'primary' : 'ghost')}
        aria-pressed={view === 'local'}
        aria-controls={`${id}-local`}
        onClick={() => setView('local')}
      >
        <FileCode2 aria-hidden className="size-4" />
        本地代码
      </button>
      <button
        type="button"
        className={buttonClass(view === 'changes' ? 'primary' : 'ghost')}
        aria-pressed={view === 'changes'}
        aria-controls={`${id}-changes`}
        onClick={() => setView('changes')}
      >
        <FileDiff aria-hidden className="size-4" />
        改动
      </button>
      <button
        type="button"
        className={buttonClass(view === 'remote' ? 'primary' : 'ghost')}
        aria-pressed={view === 'remote'}
        aria-controls={`${id}-remote`}
        onClick={() => setView('remote')}
      >
        <Server aria-hidden className="size-4" />
        服务器文件
      </button>
    </div>
  );
}
