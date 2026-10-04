import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ChevronRight, FolderRoot, RefreshCw, Server } from 'lucide-react';
import type { RemoteFileActionInput, RemoteFileActionKind, RemoteFileEntry, Workspace } from '@ssh-server/shared';
import { buttonClass, inputClass } from '../../ui/styles';
import { RemoteDirectoryList } from './RemoteDirectoryList';
import { useRemoteDirectory } from './use-remote-directory';
import { RemoteActionDialog } from './RemoteActionDialog';
import { RemoteActionToolbar } from './RemoteActionToolbar';
import { RemoteDownloadDialog } from './RemoteDownloadDialog';
import { RemoteTasks, remoteTasksKey } from './RemoteTasks';

type Browser = ReturnType<typeof useRemoteDirectory>;

export function RemoteFilesPanel({ workspace, active }: { workspace: Workspace; active: boolean }) {
  const browser = useRemoteDirectory(workspace, active);
  const [showHidden, setShowHidden] = useState(false);
  const directory = browser.directory;
  const targetChanged = browser.error?.code === 'target_changed';
  const root = browser.session?.root ?? workspace.remoteDir;
  return (
    <section aria-label="服务器文件" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Server aria-hidden className="size-4 shrink-0" />
          <span className="shrink-0 text-muted-foreground">Host</span>
          <span className="truncate font-mono" title={workspace.sshHost}>
            {workspace.sshHost}
          </span>
          {directory?.outsideWorkspace && (
            <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs">工作区外</span>
          )}
        </div>
        <p className="flex min-w-0 gap-1 text-xs text-muted-foreground">
          <span className="shrink-0">固定同步根：</span>
          <span className="truncate font-mono" dir="ltr" title={root}>
            {root}
          </span>
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          浏览只读取目录元数据，不修改同步根。在同步范围内不代表已经同步。
        </p>
      </div>
      <RemoteNavigation browser={browser} disabled={!browser.session || targetChanged} />
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />
          显示隐藏项
        </label>
        {directory && (
          <span role="status" className="text-xs text-muted-foreground">
            第 {browser.page} 页 · {directory.entries.length} 项
          </span>
        )}
      </div>
      <RemoteFeedback browser={browser} />
      <RemoteOperations
        workspace={workspace}
        browser={browser}
        active={active}
        showHidden={showHidden}
        targetChanged={targetChanged}
      />
    </section>
  );
}

function RemotePagination({ browser, targetChanged }: { browser: Browser; targetChanged: boolean }) {
  const directory = browser.directory;
  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border p-3">
      <p className="text-xs text-muted-foreground">每页最多 200 项，仅保留当前页。</p>
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={!directory || browser.loading || targetChanged}
          onClick={browser.refresh}
        >
          重新读取
        </button>
        <button
          type="button"
          className={buttonClass('outline')}
          disabled={!directory?.nextCursor || browser.loading || !!browser.error}
          onClick={browser.nextPage}
        >
          下一页
        </button>
      </div>
    </footer>
  );
}

function RemoteNavigation({ browser, disabled }: { browser: Browser; disabled: boolean }) {
  const id = useId();
  const path = browser.directory?.path ?? '';
  const [input, setInput] = useState(path);
  const [displayedPath, setDisplayedPath] = useState(path);
  if (path !== displayedPath) {
    setDisplayedPath(path);
    setInput(path);
  }
  const parent = path.slice(0, path.lastIndexOf('/')) || '/';
  return (
    <div className="shrink-0 space-y-2 border-b border-border p-3">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={disabled || !path || path === '/'}
          onClick={() => browser.navigate(parent)}
        >
          <ArrowUp aria-hidden className="size-4" />
          上级
        </button>
        <button type="button" className={buttonClass('ghost')} disabled={disabled} onClick={() => browser.navigate('')}>
          <FolderRoot aria-hidden className="size-4" />
          返回工作区
        </button>
        <button
          type="button"
          className={buttonClass('ghost')}
          aria-label="刷新服务器目录"
          disabled={disabled || browser.loading}
          onClick={browser.refresh}
        >
          <RefreshCw aria-hidden className="size-4" />
        </button>
      </div>
      {path && <Breadcrumbs path={path} disabled={disabled} navigate={browser.navigate} />}
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          browser.navigate(input);
        }}
      >
        <label htmlFor={`${id}-path`} className="min-w-0 flex-1 text-xs text-muted-foreground">
          浏览路径
          <input
            id={`${id}-path`}
            className={`${inputClass} mt-1 font-mono`}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={disabled}
            placeholder="绝对路径、~ 或工作区相对路径"
            aria-describedby={`${id}-hint`}
          />
        </label>
        <button type="submit" className={buttonClass('outline')} disabled={disabled}>
          前往
        </button>
      </form>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        相对路径从固定同步根解析；~ 表示账号主目录。
      </p>
    </div>
  );
}

function Breadcrumbs({ path, disabled, navigate }: { path: string; disabled: boolean; navigate(path: string): void }) {
  const parts = path.split('/').filter(Boolean);
  const crumbs = [
    { label: '/', path: '/' },
    ...parts.map((part, index) => ({ label: part, path: '/' + parts.slice(0, index + 1).join('/') })),
  ];
  return (
    <nav aria-label="服务器目录路径" className="min-w-0 overflow-x-auto">
      <ol className="flex w-max min-w-full items-center gap-1">
        {crumbs.map((crumb, index) => (
          <li key={crumb.path} className="flex shrink-0 items-center gap-1">
            {index > 0 && <ChevronRight aria-hidden className="size-3 text-muted-foreground" />}
            <button
              type="button"
              className={`${buttonClass('ghost')} max-w-40 px-2 font-mono text-xs`}
              title={crumb.path}
              aria-current={crumb.path === path ? 'location' : undefined}
              disabled={disabled}
              onClick={() => navigate(crumb.path)}
            >
              <span className="truncate">{crumb.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function RemoteFeedback({ browser }: { browser: Browser }) {
  if (browser.loading)
    return (
      <p role="status" className="shrink-0 px-3 py-3 text-xs">
        {browser.session ? '正在读取服务器目录…' : '正在连接服务器目录…'}
      </p>
    );
  if (!browser.error) return null;
  const code = browser.error.code;
  return (
    <div className="shrink-0 space-y-2 border-b border-border p-3">
      <p role="alert" className="break-words text-xs text-destructive-foreground">
        {browser.error.message}
      </p>
      {code === 'target_changed' ? (
        <p className="text-xs text-muted-foreground">
          目标已变化，请关闭并重新打开文件面板。未保存的本地编辑内容仍保留。
        </p>
      ) : (
        <RecoveryButton browser={browser} />
      )}
    </div>
  );
}

function RecoveryButton({ browser }: { browser: Browser }) {
  if (browser.error?.code === 'binding_failed')
    return <p className="text-xs text-muted-foreground">请关闭并重新打开文件面板，以重新登记目标。</p>;
  if (browser.error?.code === 'session_expired' || browser.error?.code === 'timeout')
    return (
      <button type="button" className={buttonClass('outline')} onClick={browser.reconnect}>
        重新连接目录
      </button>
    );
  if (browser.error?.code === 'cursor_expired')
    return (
      <button type="button" className={buttonClass('outline')} onClick={browser.refresh}>
        从第一页重新读取
      </button>
    );
  return (
    <button type="button" className={buttonClass('outline')} onClick={browser.retry}>
      重试读取
    </button>
  );
}

function RemoteOperations({
  workspace,
  browser,
  active,
  showHidden,
  targetChanged,
}: {
  workspace: Workspace;
  browser: Browser;
  active: boolean;
  showHidden: boolean;
  targetChanged: boolean;
}) {
  const directory = browser.directory;
  const [selectedPath, setSelectedPath] = useState<string>();
  const [action, setAction] = useState<RemoteFileActionInput>();
  const [download, setDownload] = useState<RemoteFileEntry>();
  const queries = useQueryClient();
  const selected = selectedEntry(directory, selectedPath, showHidden);
  const disabled = controlsDisabled(browser);
  function requestAction(kind: RemoteFileActionKind, entry?: RemoteFileEntry) {
    if (kind === 'mkdir') setAction({ kind, destination: `${directory?.path.replace(/\/$/, '') ?? ''}/` });
    else if (entry) setAction({ kind, source: entry.path, destination: kind === 'rename' ? entry.path : undefined });
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <RemoteActionToolbar
        selected={selected}
        disabled={disabled}
        action={requestAction}
        download={setDownload}
        open={(entry) => browser.navigate(entry.path)}
      />
      {directory && browser.session && (
        <RemoteDirectoryList
          directory={directory}
          showHidden={showHidden}
          loading={browser.loading || targetChanged}
          navigate={browser.navigate}
          selectedPath={selectedPath}
          select={setSelectedPath}
          action={setAction}
          download={setDownload}
          sessionId={browser.session.id}
        />
      )}
      <RemotePagination browser={browser} targetChanged={targetChanged} />
      <RemoteTasks workspaceId={workspace.id} active={active} changed={browser.refresh} />
      <OperationDialogs
        workspaceId={workspace.id}
        browser={browser}
        action={action}
        download={download}
        closeAction={() => setAction(undefined)}
        closeDownload={() => setDownload(undefined)}
        submitted={() => {
          void queries.invalidateQueries({ queryKey: remoteTasksKey(workspace.id) });
        }}
      />
    </div>
  );
}

function controlsDisabled(browser: Browser) {
  return !browser.session || browser.loading || !!browser.error;
}
function selectedEntry(directory: Browser['directory'], path: string | undefined, hidden: boolean) {
  return directory?.entries.find((entry) => entry.path === path && (hidden || !entry.name.startsWith('.')));
}

function OperationDialogs({
  workspaceId,
  browser,
  action,
  download,
  closeAction,
  closeDownload,
  submitted,
}: {
  workspaceId: string;
  browser: Browser;
  action?: RemoteFileActionInput;
  download?: RemoteFileEntry;
  closeAction(): void;
  closeDownload(): void;
  submitted(): void;
}) {
  return (
    <>
      {action && browser.session && (
        <RemoteActionDialog
          workspaceId={workspaceId}
          session={browser.session}
          input={action}
          currentPath={browser.directory?.path ?? browser.session.root}
          connect={browser.createSecondarySession}
          submitted={submitted}
          close={closeAction}
        />
      )}
      {download && browser.session && (
        <RemoteDownloadDialog
          workspaceId={workspaceId}
          session={browser.session}
          entry={download}
          close={closeDownload}
        />
      )}
    </>
  );
}
