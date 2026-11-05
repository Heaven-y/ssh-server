import { useEffect, useRef, useState } from 'react';
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';

function usePageVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

/** 可见时只询问目录版本；没有变更就不重复启动原生 CLI 读取列表。 */
export function SessionRefreshControl() {
  const client = useQueryClient();
  const visible = usePageVisible();
  const revision = useRef<number | undefined>(undefined);
  const reading = useIsFetching({ queryKey: ['sessions'] }) > 0;
  const changes = useQuery({
    queryKey: ['session-changes'],
    queryFn: ({ signal }) => api.sessionChanges(signal),
    enabled: visible,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  useEffect(() => {
    const next = changes.data?.revision;
    if (next === undefined) return;
    const previous = revision.current;
    revision.current = next;
    if (previous !== undefined && next !== previous) void client.invalidateQueries({ queryKey: ['sessions'] });
  }, [changes.data?.revision, client]);
  const notice = changes.isError ? '自动更新暂不可用，可手动刷新会话。' : changes.data?.message;
  if (!notice) return null;
  return (
    <span className="relative inline-flex shrink-0">
      {notice && (
        <span
          className="pointer-events-none absolute top-0 right-0 text-muted-foreground"
          title={notice}
          aria-label={notice}
        >
          <CircleAlert aria-hidden className="size-2.5" />
        </span>
      )}
      <button
        type="button"
        aria-label="刷新会话列表"
        title="刷新会话列表"
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-45"
        disabled={reading}
        onClick={() => {
          void client.invalidateQueries({ queryKey: ['sessions'] });
          void changes.refetch();
        }}
      >
        <RefreshCw aria-hidden className={`size-3.5 ${reading ? 'motion-safe:animate-spin' : ''}`} />
      </button>
    </span>
  );
}
