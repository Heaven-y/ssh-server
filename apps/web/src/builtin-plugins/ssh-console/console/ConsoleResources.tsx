import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { SSH_CONSOLE_LIMITS } from '@agentdeck/shared/ssh';
import { sshConsoleApi } from './api';
import { buttonClass } from '../../../ui/styles';
import { ConsoleOverview } from './ConsoleOverview';
import { useServerObservationVersion } from '../legacy/resources/use-server-observation';
import '../legacy/resources/resources.css';
import { ConsoleProcessTables } from './ConsoleProcessTables';
import { consoleError } from './console-state';

type Props = {
  serverId: string;
  directory: string;
  view: 'overview' | 'processes';
  active: boolean;
};
function useConsoleResources({ serverId, directory, view, active }: Props) {
  const client = useQueryClient();
  const version = useServerObservationVersion(serverId);
  const interval = SSH_CONSOLE_LIMITS.refreshMs;
  const enabled = active;
  const overviewKey = ['ssh-console', serverId, 'overview', directory, version] as const;
  const processKey = ['ssh-console', serverId, 'processes', version] as const;
  const overview = useQuery({
    queryKey: overviewKey,
    queryFn: ({ signal }) => sshConsoleApi.overview(serverId, directory, signal),
    enabled: enabled && view === 'overview',
    refetchInterval: enabled && view === 'overview' ? interval : false,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const processes = useQuery({
    queryKey: processKey,
    queryFn: ({ signal }) => sshConsoleApi.processes(serverId, signal),
    enabled: enabled && view === 'processes',
    refetchInterval: enabled && view === 'processes' ? interval : false,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (!enabled || view !== 'overview') void client.cancelQueries({ queryKey: ['ssh-console', serverId, 'overview'] });
    if (!enabled || view !== 'processes')
      void client.cancelQueries({ queryKey: ['ssh-console', serverId, 'processes'] });
  }, [enabled, view, client, serverId]);
  const current = view === 'overview' ? overview : processes;
  return { current, overview, processes, interval, enabled };
}

export function ConsoleResources(props: Props) {
  const { view, active } = props;
  const { current, overview, processes, interval, enabled } = useConsoleResources(props);
  return (
    <section
      aria-label={view === 'overview' ? '服务器概览' : '服务器进程'}
      className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-xs text-muted-foreground">
          {active ? `每 ${interval / 1000} 秒更新当前服务器` : '已暂停采样'}
        </p>
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={!enabled || current.isFetching}
          onClick={() => void current.refetch()}
        >
          <RefreshCw aria-hidden className="size-4" />
          刷新{view === 'overview' ? '概览' : '进程'}
        </button>
      </div>
      {current.error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {consoleError(current.error)}
        </p>
      )}
      {current.isFetching && !current.data && (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取服务器数据…
        </p>
      )}
      <ResourceBody view={view} overview={overview.data} processes={processes.data} />
    </section>
  );
}
function ResourceBody({
  view,
  overview,
  processes,
}: {
  view: Props['view'];
  overview?: Awaited<ReturnType<typeof sshConsoleApi.overview>>;
  processes?: Awaited<ReturnType<typeof sshConsoleApi.processes>>;
}) {
  if (view === 'overview') return <ConsoleOverview snapshot={overview} />;
  return processes && <ConsoleProcessTables data={processes} />;
}
