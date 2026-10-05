import { lazy, Suspense, useId, useState } from 'react';
import { CircleAlert, FileCode2, FileDiff, RefreshCw, Save, Server, X } from 'lucide-react';
import type { Workspace } from '@ssh-server/shared';
import { CodeEditor, type CodeFormat } from '../../ui/CodeEditor';
import { buttonClass, inputClass } from '../../ui/styles';
import { FileDirectory } from './FileDirectory';
import { FilePanelFrame } from './FilePanelFrame';
import { useFileEditor } from './use-file-editor';
import { RemoteFilesPanel } from '../remote-files/RemoteFilesPanel';
import { DisconnectedEditors } from './DisconnectedEditors';
import { useChat } from '../chat/chat-store';
import type { ChangesRequest } from '../changes/types';

const ChangesPanel = lazy(() => import('../changes/ChangesPanel'));
type FileView = 'local' | 'remote' | 'changes';

const FORMATS: Record<string, CodeFormat> = {
  py: 'python',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  sh: 'shell',
  bash: 'shell',
  slurm: 'shell',
  json: 'json',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
};
function formatOf(file: string): CodeFormat {
  return FORMATS[file.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'text';
}

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
  dirty,
}: {
  id: string;
  workspace: Workspace;
  fileView: ReturnType<typeof useFileView>;
  dirty: boolean;
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
            active={fileView.view === 'changes'}
            request={fileView.request}
            dirty={dirty}
          />
        </Suspense>
      )}
    </div>
  );
}

/** 面板绑定打开时的工作区；切换对话工作区不会迁移或丢弃编辑缓冲。 */
export default function FilesPanel({
  workspace: initialWorkspace,
  onClose,
  changesRequest,
}: {
  workspace: Workspace;
  onClose(): void;
  changesRequest?: ChangesRequest;
}) {
  const id = useId();
  const [workspace] = useState(initialWorkspace);
  const fileView = useFileView(workspace, changesRequest);
  const { view, setView } = fileView;
  const editor = useFileEditor(workspace.id);
  const editingDisabled = !!editor.busy || !!editor.protection;
  const [pathInput, setPathInput] = useState('');
  const close = () => {
    if (editor.canClose()) onClose();
  };
  return (
    <FilePanelFrame close={close}>
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <FileCode2 aria-hidden className="size-4" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">文件</h2>
          <p className="truncate text-xs text-muted-foreground">工作区：{workspace.name}</p>
        </div>
        <button
          type="button"
          className={buttonClass('ghost')}
          aria-label="关闭文件面板"
          disabled={!!editor.busy}
          onClick={close}
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>
      <FileViewSelector id={id} view={view} dirty={editor.dirty} setView={setView} />
      <section
        id={`${id}-local`}
        aria-label="本地代码"
        hidden={view !== 'local'}
        className={view === 'local' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
      >
        <FileDirectory
          workspaceId={workspace.id}
          disabled={editingDisabled}
          openFile={(relative) => {
            void editor.open(relative);
          }}
        />
        <form
          className="flex shrink-0 items-end gap-2 border-b border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (pathInput.trim()) void editor.open(pathInput.trim());
          }}
        >
          <label htmlFor={`${id}-path`} className="min-w-0 flex-1 text-xs text-muted-foreground">
            相对路径
            <input
              id={`${id}-path`}
              className={`${inputClass} mt-1 font-mono`}
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              placeholder="src/train.py"
              disabled={editingDisabled}
            />
          </label>
          <button type="submit" className={buttonClass('outline')} disabled={editingDisabled || !pathInput.trim()}>
            打开
          </button>
        </form>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          {editor.file ? (
            <>
              <div className="flex shrink-0 items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={editor.file.path}>
                  {editor.file.path}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {editor.dirty ? '未保存' : '已读取'} · {formatOf(editor.file.path)}
                </span>
                <button
                  type="button"
                  className={buttonClass('ghost')}
                  disabled={editingDisabled}
                  aria-label="重新读取文件"
                  onClick={() => {
                    void editor.open(editor.file!.path);
                  }}
                >
                  <RefreshCw aria-hidden className="size-4" />
                </button>
              </div>
              {editor.external && (
                <p role="alert" className="flex gap-2 border-y border-border p-3 text-xs text-destructive-foreground">
                  <CircleAlert aria-hidden className="size-4 shrink-0" />
                  {editor.external}
                </p>
              )}
              <div className="min-h-56 flex-1">
                <CodeEditor
                  key={editor.file.path}
                  value={editor.content}
                  format={formatOf(editor.file.path)}
                  label="项目文件内容"
                  height="100%"
                  disabled={editingDisabled}
                  lineSeparator={editor.file.content.includes('\r\n') ? '\r\n' : '\n'}
                  onChange={editor.edit}
                />
              </div>
            </>
          ) : (
            <p className="m-auto max-w-xs p-6 text-sm leading-6 text-muted-foreground">
              选择本地脚本或配置文件开始编辑。文件列表沿用同步范围，编辑仅支持不超过 2 MiB 的 UTF-8 文本。
            </p>
          )}
        </div>
        <EditorFooter editor={editor} />
      </section>
      <div
        id={`${id}-remote`}
        hidden={view !== 'remote'}
        className={view === 'remote' ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}
      >
        <RemoteFilesPanel workspace={workspace} active={view === 'remote'} />
      </div>
      <ChangesArea id={id} workspace={workspace} fileView={fileView} dirty={editor.dirty} />
      <DisconnectedEditors workspaceId={workspace.id} />
    </FilePanelFrame>
  );
}

function FileViewSelector({
  id,
  view,
  dirty,
  setView,
}: {
  id: string;
  view: FileView;
  dirty: boolean;
  setView(view: FileView): void;
}) {
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
        {dirty && <span className="text-xs">· 未保存</span>}
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

function EditorFooter({ editor }: { editor: ReturnType<typeof useFileEditor> }) {
  return (
    <footer className="shrink-0 border-t border-border p-3">
      {editor.protection && (
        <p role="status" className="mb-2 text-xs">
          {editor.protection}
        </p>
      )}
      {editor.busy === 'loading' && (
        <p role="status" className="mb-2 text-xs">
          正在读取文件…
        </p>
      )}
      {editor.message && (
        <p role="status" className="mb-2 text-xs">
          {editor.message}
        </p>
      )}
      {editor.error && (
        <p role="alert" className="mb-2 text-xs text-destructive-foreground">
          {editor.error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">保存后同步，不创建版本提交。</p>
        <button
          type="button"
          className={buttonClass('primary')}
          disabled={!editor.dirty || !!editor.busy || !!editor.protection}
          onClick={() => {
            void editor.save();
          }}
        >
          <Save aria-hidden className="size-4" />
          {editor.busy === 'saving' ? '正在保存…' : '保存文件'}
        </button>
      </div>
    </footer>
  );
}
