import { useId, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { RefreshCw, Save } from 'lucide-react';
import { VERSION_MESSAGE_MAX_LENGTH, type VersionStatus, type Workspace } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { buttonClass, inputClass } from '../../ui/styles';
import { ChangeList, ExcludedList, HistoryList } from './VersionLists';
import { RestoreConfirmation, VersionDiffView, type VersionSelection } from './VersionDiffView';
import { useVersionActions, type VersionNotice } from './use-version-actions';

type Props = {
  workspace: Workspace;
  status?: VersionStatus;
  statusError?: string;
  refreshing: boolean;
  refresh(): void;
  busy: boolean;
  setBusy(busy: boolean): void;
};
type VersionActions = ReturnType<typeof useVersionActions>;
const TONES: Record<VersionNotice['tone'], string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-destructive-foreground',
};
function Notice({ notice }: { notice?: VersionNotice }) {
  return notice ? (
    <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`text-sm leading-6 ${TONES[notice.tone]}`}>
      {notice.text}
    </p>
  ) : null;
}
function VersionOverview({ workspace, status, statusError, refreshing, refresh, busy }: Omit<Props, 'setBusy'>) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {workspace.name}
            {status?.branch ? ` · ${status.branch}` : ''}
          </p>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">
            仅记录已保存到本地磁盘的小文件，不包含编辑器中尚未保存的内容。
          </p>
        </div>
        <button
          type="button"
          className={buttonClass('ghost')}
          aria-label="刷新版本状态"
          disabled={busy || refreshing}
          onClick={refresh}
        >
          <RefreshCw aria-hidden className={`size-4 ${refreshing ? 'motion-safe:animate-spin' : ''}`} />
        </button>
      </div>
      {statusError && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {statusError}
        </p>
      )}
      {!status && (
        <p className="text-sm text-muted-foreground">
          {statusError ? '准备版本记录失败，可点击刷新重试。' : '正在准备本地版本记录…'}
        </p>
      )}
    </>
  );
}
function ActionFeedback({ actions, busy }: { actions: VersionActions; busy: boolean }) {
  return (
    <>
      {actions.error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {actions.error}
        </p>
      )}
      {actions.affectedPaths.length > 0 && (
        <div className="space-y-2 text-sm">
          <p className="text-warning">操作未全部完成，以下本地文件已受影响：</p>
          <ul className="max-h-40 overflow-auto font-mono text-xs leading-6 wrap-anywhere">
            {actions.affectedPaths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </div>
      )}
      <Notice notice={actions.notice} />
      <Notice notice={actions.syncResult} />
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          正在处理，请等待操作完成…
        </p>
      )}
    </>
  );
}
type CurrentProps = {
  status: VersionStatus;
  busy: boolean;
  message: string;
  setMessage(message: string): void;
  select(selection: VersionSelection): void;
  save(): void;
};
function CurrentChanges({ status, busy, message, setMessage, select, save }: CurrentProps) {
  const id = useId();
  const canSave = status.initialized && status.changes.length > 0 && !!message.trim() && !busy;
  return (
    <section className="space-y-4" aria-label="当前改动">
      <div>
        <ChangeList changes={status.changes} disabled={busy} select={(path) => select({ path })} />
        <ExcludedList excluded={status.excluded} />
      </div>
      {!!status.changes.length && (
        <button type="button" className={buttonClass('ghost')} disabled={busy} onClick={() => select({})}>
          查看全部差异
        </button>
      )}
      <form
        className="space-y-3 border-t border-border pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) save();
        }}
      >
        <label htmlFor={id} className="block text-sm">
          版本说明
          <input
            id={id}
            className={`${inputClass} mt-2`}
            value={message}
            maxLength={VERSION_MESSAGE_MAX_LENGTH}
            disabled={busy}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <div className="flex justify-end">
          <button type="submit" className={buttonClass('primary')} disabled={!canSave}>
            <Save aria-hidden className="size-4" />
            保存版本
          </button>
        </div>
      </form>
    </section>
  );
}
function MoreHistory({
  hasMore,
  busy,
  loading,
  load,
}: {
  hasMore: boolean;
  busy: boolean;
  loading: boolean;
  load(): void;
}) {
  return hasMore ? (
    <button type="button" className={buttonClass('outline')} disabled={busy || loading} onClick={load}>
      {loading ? '正在读取…' : '加载更早的 30 条'}
    </button>
  ) : null;
}
function VersionHistoryView({
  workspaceId,
  selected,
  busy,
  select,
}: {
  workspaceId: string;
  selected?: string;
  busy: boolean;
  select(commit: string): void;
}) {
  const history = useInfiniteQuery({
    queryKey: [...queryKeys.versions(workspaceId), 'history'],
    queryFn: ({ pageParam }) => api.versionHistory(workspaceId, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length * 30 : undefined),
    retry: false,
  });
  return (
    <section className="space-y-3" aria-label="历史版本">
      {history.isPending && <p className="text-sm text-muted-foreground">正在读取历史…</p>}
      {history.error && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive-foreground">
            {history.error.message}
          </p>
          <button
            type="button"
            className={buttonClass('outline')}
            disabled={busy || history.isFetching}
            onClick={() => {
              void history.refetch();
            }}
          >
            重新读取历史
          </button>
        </div>
      )}
      {history.data && (
        <HistoryList
          commits={history.data.pages.flatMap((page) => page.commits)}
          selected={selected}
          disabled={busy}
          select={select}
        />
      )}
      {history.data?.pages[0]?.commits.length === 0 && (
        <p className="text-sm text-muted-foreground">尚无版本。保存当前改动后，记录会出现在这里。</p>
      )}
      <MoreHistory
        hasMore={history.hasNextPage}
        busy={busy}
        loading={history.isFetchingNextPage}
        load={() => {
          void history.fetchNextPage();
        }}
      />
    </section>
  );
}
function useVersionDiff(id: string, selection: VersionSelection, revision?: string) {
  const key = [...queryKeys.versions(id), 'diff', selection.commit ?? 'working', selection.commit ? '' : revision];
  const whole = useQuery({
    queryKey: key,
    queryFn: () => api.versionDiff(id, { commit: selection.commit }),
    staleTime: Infinity,
    retry: false,
  });
  const file = useQuery({
    queryKey: [...key, selection.path],
    queryFn: () => api.versionDiff(id, selection),
    enabled: !!selection.path && whole.isSuccess,
    staleTime: Infinity,
    retry: false,
  });
  return { whole, selected: selection.path ? file : whole };
}
type SelectedDiffProps = {
  workspaceId: string;
  revision?: string;
  selection: VersionSelection;
  busy: boolean;
  select(selection: VersionSelection): void;
  prepare(): void;
};
function SelectedDiff({ workspaceId, revision, selection, busy, select, prepare }: SelectedDiffProps) {
  const diff = useVersionDiff(workspaceId, selection, revision);
  return (
    <VersionDiffView
      selection={selection}
      files={diff.whole.data?.files ?? []}
      diff={diff.selected.data}
      loading={diff.whole.isFetching || diff.selected.isFetching}
      error={diff.whole.error?.message ?? diff.selected.error?.message}
      busy={busy}
      select={select}
      retry={() => {
        void diff.whole.refetch();
        if (selection.path) void diff.selected.refetch();
      }}
      prepare={prepare}
    />
  );
}

export default function VersionsDetails(props: Props) {
  const { workspace, status, busy, setBusy } = props;
  const { revision } = status ?? {};
  const [view, setView] = useState<'current' | 'history'>('current');
  const [message, setMessage] = useState('更新项目文件');
  const [selection, setSelection] = useState<VersionSelection>();
  const actions = useVersionActions(workspace.id, setBusy);
  const select = (next: VersionSelection) => {
    setSelection(next);
    actions.clearPreview();
  };
  const prepare = () => {
    if (selection?.commit) void actions.prepare(selection.commit, selection.path);
  };
  const switchView = (next: 'current' | 'history') => {
    setView(next);
    setSelection(undefined);
    actions.clearPreview();
  };
  return (
    <div className="space-y-5">
      <VersionOverview {...props} />
      <ActionFeedback actions={actions} busy={busy} />
      {status && (
        <>
          <div className="flex gap-1 border-b border-border pb-2">
            <button
              type="button"
              className={buttonClass(view === 'current' ? 'outline' : 'ghost')}
              aria-pressed={view === 'current'}
              disabled={busy}
              onClick={() => switchView('current')}
            >
              当前改动（{status.changes.length}）
            </button>
            <button
              type="button"
              className={buttonClass(view === 'history' ? 'outline' : 'ghost')}
              aria-pressed={view === 'history'}
              disabled={busy || !status.initialized}
              onClick={() => switchView('history')}
            >
              历史版本
            </button>
          </div>
          {view === 'current' ? (
            <CurrentChanges
              status={status}
              busy={busy}
              message={message}
              setMessage={setMessage}
              select={select}
              save={() => {
                void actions.save(message.trim(), status.revision);
              }}
            />
          ) : (
            <VersionHistoryView
              workspaceId={workspace.id}
              selected={selection?.commit}
              busy={busy}
              select={(commit) => select({ commit })}
            />
          )}
        </>
      )}
      {selection && (
        <SelectedDiff
          workspaceId={workspace.id}
          revision={revision}
          selection={selection}
          busy={busy}
          select={select}
          prepare={prepare}
        />
      )}
      {actions.preview && (
        <RestoreConfirmation
          key={actions.previewVersion}
          preview={actions.preview}
          statusRevision={revision}
          previewStatusRevision={actions.previewStatusRevision}
          busy={busy}
          prepare={prepare}
          restore={() => {
            void actions.restore();
          }}
        />
      )}
    </div>
  );
}
