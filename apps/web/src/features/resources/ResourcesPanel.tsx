import { RefreshCw, Server } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { ManagedServer, ResourceSnapshot, Workspace } from '@ssh-server/shared';
import { api, queryKeys, type SshCredentialStatus } from '../../lib/api';
import { buttonClass } from '../../ui/styles';
import { ResourceMetrics } from './ResourceMetrics';
import { useResources, readingState, resourceTime, type ResourcesController } from './use-resources';
import { SlurmJobs } from './SlurmJobs';
import { SettingsLoadError } from '../settings/SettingsLoadError';
import './resources.css';

function connectionLabel(status?: SshCredentialStatus) {
  if (!status) return '连接状态尚未读取';
  if (status.paused) return 'SSH已主动断开';
  return status.connected ? 'SSH已连接' : 'SSH未连接';
}
function ResourceMetadata({
  workspace,
  server,
  snapshot,
}: {
  workspace: Workspace;
  server?: ManagedServer;
  snapshot?: ResourceSnapshot;
}) {
  return (
    <details className="resource-metadata text-xs leading-5 text-muted-foreground">
      <summary className="cursor-pointer rounded py-1 focus-visible:outline-2 focus-visible:outline-accent">
        目标与采样详情
      </summary>
      <div className="mt-2 space-y-1 break-all">
        <p>实际目标：{server ? `${server.username}@${server.hostname}:${server.port}` : '档案尚未读取'}</p>
        <p>SSH别名：{workspace.sshHost}</p>
        <p>采集主机：{snapshot?.host.data?.hostname ?? '不可用'}</p>
        <p>项目目录：{workspace.remoteDir}</p>
        <p>节点更新：{resourceTime(snapshot?.host.sampledAt)}</p>
        <p>磁盘更新：{resourceTime(snapshot?.disk.sampledAt)}</p>
      </div>
    </details>
  );
}
function resourceLabel(pending: boolean, stale: boolean) {
  if (pending) return '正在读取资源…';
  return stale ? '已过期 / 部分不可用' : '最近采样有效';
}
function ResourceReading({ controller }: { controller: ResourcesController }) {
  const { query, active, pauseReason, now, timing, settings } = controller;
  const { stale, message } = readingState(query.data, query.error, now, timing.staleMs);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          role="status"
          className="resource-status"
          data-attention={stale}
          data-neutral={!!pauseReason || query.isPending}
        >
          {pauseReason ?? resourceLabel(query.isPending, stale)}
        </p>
        <button
          type="button"
          className={buttonClass('ghost')}
          aria-label="刷新资源"
          disabled={query.isFetching || !active}
          onClick={() => void query.refetch()}
        >
          <RefreshCw aria-hidden className={`size-3.5 ${query.isFetching ? 'motion-safe:animate-spin' : ''}`} />
          刷新
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        节点更新：{resourceTime(query.data?.host.sampledAt)} · 每{timing.intervalMs / 1000}秒检查
      </p>
      <SettingsLoadError error={settings.error} retry={settings.refetch} message="产品设置读取失败，资源检查已暂停" />
      {message && (
        <p role="alert" className="text-xs leading-5 text-destructive-foreground">
          {message}。可在工作区连接入口处理后刷新。
        </p>
      )}
      <ResourceMetrics host={query.data?.host.data} disk={query.data?.disk.data} />
    </>
  );
}
export function ResourcesPanel({ workspace, active }: { workspace: Workspace; active: boolean }) {
  const controller = useResources(workspace, active);
  const servers = useQuery({
    queryKey: queryKeys.sshHosts,
    queryFn: ({ signal }) => api.listSshHosts(signal),
    enabled: active,
    staleTime: 10_000,
    retry: false,
  });
  // 共用工作区连接栏的状态；资源面板不增加第二套SSH轮询。
  const credentials = useQuery({
    queryKey: queryKeys.sshCredentials(workspace.sshHost),
    queryFn: ({ signal }) => api.sshCredentials(workspace.sshHost, signal),
    enabled: false,
  });
  const server = servers.data?.find((item) => item.alias === workspace.sshHost);
  return (
    <section aria-label="服务器资源" className="resource-scope min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <header className="space-y-2">
        <div className="flex items-start gap-2.5">
          <Server aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-sm font-semibold">{server?.name ?? workspace.sshHost}</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={workspace.name}>
              {workspace.name} · {connectionLabel(credentials.data)}
            </p>
          </div>
        </div>
        {servers.error && (
          <p role="status" className="text-xs text-destructive-foreground">
            服务器档案读取失败，暂以SSH别名标识。
          </p>
        )}
        <ResourceMetadata workspace={workspace} server={server} snapshot={controller.query.data} />
      </header>
      <ResourceReading controller={controller} />
      <p className="text-xs leading-5 text-muted-foreground">当前 SSH 节点；CPU 利用率需连续两次采样。</p>
      <SlurmJobs target={controller.target} active={controller.canRead} />
    </section>
  );
}
