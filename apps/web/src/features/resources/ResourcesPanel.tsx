import { RefreshCw } from 'lucide-react';
import { useImperativeHandle, useState, type Ref } from 'react';
import { type Workspace, type ResourceSnapshot } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { DetailDialog } from '../../ui/DetailDialog';
import { ResourceMetrics } from './ResourceMetrics';
import { useResources, readingState, resourceTime, type ResourcesController } from './use-resources';
import { ResourceOverview } from './ResourceOverview';
import { SettingsLoadError } from '../settings/SettingsLoadError';

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
        节点更新：{resourceTime(snapshot?.host.sampledAt)} · 磁盘更新：{resourceTime(snapshot?.disk.sampledAt)}
      </p>
    </div>
  );
}
function resourceLabel(pending: boolean, stale: boolean) {
  if (pending) return '正在读取资源…';
  return stale ? '已过期 / 部分不可用' : '最近采样有效';
}
function ResourceDetails({
  workspace,
  controller,
  onClose,
}: {
  workspace: Workspace;
  controller: ResourcesController;
  onClose(): void;
}) {
  const { query, active, pauseReason, now, timing, settings } = controller;
  const { stale, message } = readingState(query.data, query.error, now, timing.staleMs);
  return (
    <DetailDialog title="服务器资源" onClose={onClose}>
      <div className="space-y-4">
        <ResourceMetadata workspace={workspace} snapshot={query.data} />
        <div className="flex items-center justify-between gap-2">
          <p role="status" className="text-xs text-muted-foreground">
            {resourceLabel(query.isPending, stale)} · {pauseReason ?? `每${timing.intervalMs / 1000}秒检查`}
          </p>
          <button
            type="button"
            className={buttonClass('outline')}
            disabled={query.isFetching || !active}
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

export type ResourcesActions = { open(workspaceId: string): boolean };
export function ResourcesPanel({ workspace, ref }: { workspace: Workspace; ref?: Ref<ResourcesActions> }) {
  const controller = useResources(workspace);
  const [opened, setOpened] = useState(false);
  useImperativeHandle(
    ref,
    () => ({
      open(id) {
        if (id !== workspace.id) return false;
        setOpened(true);
        return true;
      },
    }),
    [workspace.id],
  );
  return (
    <>
      <ResourceOverview controller={controller} opened={opened} open={() => setOpened(true)} />
      {opened && <ResourceDetails workspace={workspace} controller={controller} onClose={() => setOpened(false)} />}
    </>
  );
}
