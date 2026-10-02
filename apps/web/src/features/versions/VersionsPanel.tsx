import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, GitBranch, LoaderCircle } from 'lucide-react';
import type { VersionStatus, Workspace } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass } from '../../ui/styles';

const VersionsDetails = lazy(() => import('./VersionsDetails'));

function useVersionStatus(id: string, busy: boolean) {
  const initialized = useRef(false);
  const initialization = useRef<Promise<VersionStatus> | undefined>(undefined);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  const query = useQuery({
    queryKey: queryKeys.versions(id),
    queryFn: async () => {
      if (initialized.current) return api.versionStatus(id);
      initialization.current ??= api.initializeVersions(id);
      const status = await initialization.current;
      initialized.current = true;
      return status;
    },
    enabled: visible && !busy,
    refetchInterval: (current) => (visible && !current.state.error && current.state.data?.initialized ? 15_000 : false),
    retry: false,
  });
  return {
    ...query,
    reload() {
      if (query.isError && !initialized.current) initialization.current = undefined;
      void query.refetch();
    },
  };
}

function summaryText(status: ReturnType<typeof useVersionStatus>) {
  if (status.isError) return '版本记录异常';
  if (!status.data) return '准备版本记录';
  if (status.data.changes.length) return `${status.data.changes.length} 项未记录改动`;
  return status.data.head ? '版本已记录' : '尚无版本记录';
}

function WorkspaceVersions({ workspace }: { workspace: Workspace }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const query = useVersionStatus(workspace.id, busy);
  const Icon = query.isError ? CircleAlert : GitBranch;
  const refresh = query.reload;
  return (
    <>
      <button
        type="button"
        className={`${buttonClass('ghost')} px-2 ${query.isError ? 'text-warning' : 'text-muted-foreground'}`}
        aria-label="版本记录详情"
        aria-expanded={expanded}
        aria-haspopup="dialog"
        title={query.error?.message ?? '查看本地改动、保存版本或恢复历史文件'}
        onClick={() => {
          setExpanded(true);
          if (!query.isFetching) refresh();
        }}
      >
        {query.isPending || busy ? (
          <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" />
        ) : (
          <Icon aria-hidden className="size-3.5" />
        )}
        <span className="text-xs">{busy ? '处理版本记录' : summaryText(query)}</span>
      </button>
      {expanded && (
        <DetailDialog title="版本记录" busy={busy} onClose={() => setExpanded(false)}>
          <Suspense fallback={<p className="text-sm text-muted-foreground">正在打开版本记录…</p>}>
            <VersionsDetails
              workspace={workspace}
              status={query.data}
              statusError={query.error?.message}
              refreshing={query.isFetching}
              refresh={refresh}
              busy={busy}
              setBusy={setBusy}
            />
          </Suspense>
        </DetailDialog>
      )}
    </>
  );
}

/** 工作区打开时初始化一次，收起详情后仅保留可见页面的轻量状态刷新。 */
export function VersionsPanel({ workspace }: { workspace: Workspace }) {
  return <WorkspaceVersions key={JSON.stringify([workspace.id, workspace.localDir])} workspace={workspace} />;
}
