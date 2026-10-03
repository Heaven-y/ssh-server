import { useId, useState } from 'react';
import { CircleAlert, FileCode2, RefreshCw, Save, Server, X } from 'lucide-react';
import type { Workspace } from '@ssh-server/shared';
import { CodeEditor, type CodeFormat } from '../../ui/CodeEditor';
import { buttonClass, inputClass } from '../../ui/styles';
import { FileDirectory } from './FileDirectory';
import { FilePanelFrame } from './FilePanelFrame';
import { useFileEditor } from './use-file-editor';
import { RemoteFilesPanel } from '../remote-files/RemoteFilesPanel';

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

/** 面板绑定打开时的工作区；切换对话工作区不会迁移或丢弃编辑缓冲。 */
export default function FilesPanel({
  workspace: initialWorkspace,
  onClose,
}: {
  workspace: Workspace;
  onClose(): void;
}) {
  const id = useId();
  const [workspace] = useState(initialWorkspace);
  const [view, setView] = useState<'local' | 'remote'>('local');
  const editor = useFileEditor(workspace.id);
  const [pathInput, setPathInput] = useState('');
  const close = () => {
    if (editor.canLeave()) onClose();
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
          disabled={!!editor.busy}
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
              disabled={!!editor.busy}
            />
          </label>
          <button type="submit" className={buttonClass('outline')} disabled={!!editor.busy || !pathInput.trim()}>
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
                  disabled={!!editor.busy}
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
                  disabled={!!editor.busy}
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
  view: 'local' | 'remote';
  dirty: boolean;
  setView(view: 'local' | 'remote'): void;
}) {
  return (
    <div role="group" aria-label="文件视图" className="flex shrink-0 gap-2 border-b border-border px-3 py-2">
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
          disabled={!editor.dirty || !!editor.busy}
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
