import { Activity, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  RESOURCE_LIMITS,
  resourceTiming,
  workspaceTerminalTarget,
  terminalTargetKey,
  type Workspace,
  type ResourceSnapshot,
} from '@ssh-server/shared';
import { api, ApiError } from '../../lib/api';
import { buttonClass } from '../../ui/styles';
import { DetailDialog } from '../../ui/DetailDialog';
import { ResourceMetrics } from './ResourceMetrics';
import { useProductSettings } from '../settings/use-product-settings';
import { SettingsLoadError } from '../settings/SettingsLoadError';

function usePageVisible(intervalMs: number) {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const change = () => {
      setVisible(document.visibilityState === 'visible');
      setNow(Date.now());
    };
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [visible, intervalMs]);
  return { visible, now };
}
function useResources(workspace: Workspace) {
  const settings = useProductSettings();
  const timing = settings.data ? resourceTiming(settings.data.settings.resources) : RESOURCE_LIMITS;
  const target = workspaceTerminalTarget(workspace);
  const { visible, now } = usePageVisible(timing.intervalMs);
  const query = useQuery({
    queryKey: ['resources', workspace.id, terminalTargetKey(target)],
    queryFn: ({ signal }) => api.readResources(target, signal),
    enabled: visible && settings.isSuccess,
    staleTime: 0,
    gcTime: RESOURCE_LIMITS.idleMs,
    retry: false,
    refetchInterval: (state) =>
      state.state.error instanceof ApiError &&
      ['target_changed', 'workspace_missing'].includes(state.state.error.code ?? '')
        ? false
        : timing.intervalMs,
    refetchIntervalInBackground: false,
  });
  return { query, target, visible, now, timing, settings };
}
function readingState(snapshot: ResourceSnapshot | undefined, error: Error | null, now: number, staleMs: number) {
  const readings = [snapshot?.host, snapshot?.disk];
  const stale =
    !!error ||
    readings.some(
      (reading) => !reading || reading.stale || reading.sampledAt === null || now - reading.sampledAt > staleMs,
    );
  const message = error instanceof ApiError ? error.message : readings.find((reading) => reading?.message)?.message;
  return { stale, message };
}
const time = (at: number | null | undefined) => (at ? new Date(at).toLocaleTimeString('zh-CN') : '尚无成功采样');
function ResourceMetadata({ workspace, snapshot }: { workspace: Workspace; snapshot?: ResourceSnapshot }) {
  return (
    <div className="space-y-1 text-xs leading-5 text-muted-foreground">
      <p className="break-all">
        {workspace.name} · Host {workspace.sshHost}
      </p>
      <p className="break-all">
        采集主机：{snapshot?.host.data?.hostname ?? '不可用'} · 项目目录：{workspace.remoteDir}
      </p>
      <p>
        节点更新：{time(snapshot?.host.sampledAt)} · 磁盘更新：{time(snapshot?.disk.sampledAt)}
      </p>
    </div>
  );
}
function resourceLabel(pending: boolean, stale: boolean) {
  if (pending) return '正在读取资源…';
  return stale ? '已过期 / 部分不可用' : '最近采样有效';
}
function ResourceDetails({ workspace, onClose }: { workspace: Workspace; onClose(): void }) {
  const { query, visible, now, timing, settings } = useResources(workspace);
  const { stale, message } = readingState(query.data, query.error, now, timing.staleMs);
  return (
    <DetailDialog title="服务器资源" onClose={onClose}>
      <div className="space-y-4">
        <ResourceMetadata workspace={workspace} snapshot={query.data} />
        <div className="flex items-center justify-between gap-2">
          <p role="status" className="text-xs text-muted-foreground">
            {resourceLabel(query.isPending, stale)} ·{' '}
            {visible ? `每${timing.intervalMs / 1000}秒检查` : '页面隐藏，已暂停'}
          </p>
          <button
            type="button"
            className={buttonClass('outline')}
            disabled={query.isFetching || !visible || !settings.isSuccess}
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden className="size-4" />
            刷新
          </button>
        </div>
        <SettingsLoadError error={settings.error} retry={settings.refetch} message="产品设置读取失败，资源检查已暂停" />
        {message ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {message}。可在工作区连接入口处理后刷新。
          </p>
        ) : null}
        <ResourceMetrics host={query.data?.host.data ?? null} disk={query.data?.disk.data ?? null} />
        <p className="text-xs leading-5 text-muted-foreground">
          只展示本次SSH节点；CPU需连续两次采样。缺少工具或权限时显示不可用。采样不运行模型，也不检测训练是否完成。
        </p>
      </div>
    </DetailDialog>
  );
}

export function ResourcesPanel({ workspace }: { workspace: Workspace }) {
  const [opened, setOpened] = useState<Workspace>();
  return (
    <>
      <button
        type="button"
        className={buttonClass('ghost')}
        aria-expanded={!!opened}
        onClick={() => setOpened((previous) => previous ?? { ...workspace })}
      >
        <Activity aria-hidden className="size-4" />
        资源
      </button>
      {opened ? <ResourceDetails workspace={opened} onClose={() => setOpened(undefined)} /> : null}
    </>
  );
}
