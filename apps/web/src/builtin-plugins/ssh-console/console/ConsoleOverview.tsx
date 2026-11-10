import type { ReactNode } from 'react';
import type { SshConsoleOverview, SshConsoleDisk, SshConsoleHost } from '@agentdeck/shared/ssh';
import { GpuList } from '../legacy/resources/ResourceMetrics';
import { ResourceMeter, capacityPercent } from '../legacy/resources/ResourceMeter';
import { formatBytes, formatPercent } from './console-state';

function Metric({
  label,
  value,
  detail,
  percent,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  percent: number | null;
}) {
  return (
    <div className="resource-metric-card min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-2 space-y-2">
        <span className="block break-words font-mono text-base">{value}</span>
        {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
        <ResourceMeter label={label} value={percent} />
      </dd>
    </div>
  );
}
function DiskList({ disks }: { disks: SshConsoleDisk[] | null }) {
  return (
    <section aria-label="磁盘挂载" className="resource-metric-card space-y-3">
      <h3 className="text-sm font-semibold">磁盘</h3>
      {disks === null ? (
        <p className="text-sm text-muted-foreground">磁盘指标不可用。</p>
      ) : !disks.length ? (
        <p className="text-sm text-muted-foreground">没有可显示的磁盘挂载。</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {disks.map((disk) => (
            <li key={JSON.stringify([disk.filesystem, disk.mount])} className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
                <span className="min-w-0 break-all font-mono" title={disk.filesystem}>
                  {disk.mount}
                </span>
                <span className="shrink-0 font-mono">{formatPercent(disk.usedPercent)}</span>
              </div>
              <ResourceMeter label={`${disk.mount} 使用率`} value={disk.usedPercent} tone="memory" />
              <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <span>
                  {formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)}
                </span>
                <span>剩余 {formatBytes(disk.availableBytes)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
const EMPTY_SUMMARY = { cpuPercent: null, cpuCores: null, load: null, memoryUsed: null, memoryTotal: null };
type Summary = Pick<SshConsoleHost, keyof typeof EMPTY_SUMMARY>;
function LoadMetric({ host }: { host: Summary }) {
  const perCore = host.load && host.cpuCores ? host.load[0] / host.cpuCores : null;
  return (
    <Metric
      label="平均负载"
      value={host.load?.map((value) => value.toFixed(2)).join(' / ') ?? '不可用'}
      percent={perCore === null ? null : perCore * 100}
      detail={
        <span title="最近 1 / 5 / 15 分钟，平均有多少进程正在运行或等待 CPU、磁盘。">
          1 / 5 / 15 分钟{perCore === null ? '' : ` · ${perCore.toFixed(2)}/核`}
        </span>
      }
    />
  );
}
function HostSummary({ host }: { host: SshConsoleHost | null }) {
  const data = host ?? EMPTY_SUMMARY;
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Metric
        label="CPU 利用率"
        value={formatPercent(data.cpuPercent)}
        percent={data.cpuPercent}
        detail={data.cpuCores ? `${data.cpuCores} 核` : '核数不可用'}
      />
      <Metric
        label="内存（已用 / 总量）"
        value={`${formatBytes(data.memoryUsed)} / ${formatBytes(data.memoryTotal)}`}
        percent={capacityPercent(data.memoryUsed, data.memoryTotal)}
      />
      <LoadMetric host={data} />
    </dl>
  );
}
function HostInformation({ host }: { host: SshConsoleHost }) {
  return (
    <>
      <span>采集主机：{host.hostname ?? '不可用'}</span>
      {host.system && <span>{host.system}</span>}
      {host.uptimeSeconds !== null && (
        <span>
          已运行 {Math.floor(host.uptimeSeconds / 3600)} 小时 {Math.floor((host.uptimeSeconds % 3600) / 60)} 分钟
        </span>
      )}
    </>
  );
}
export function ConsoleOverview({ snapshot }: { snapshot?: SshConsoleOverview }) {
  if (!snapshot) return null;
  const host = snapshot.host.data;
  const message = snapshot.host.message ?? snapshot.disk.message;
  return (
    <div className="resource-scope space-y-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {host && <HostInformation host={host} />}
        <span>{snapshot.host.stale || snapshot.disk.stale ? '部分数据已过期' : '数据已更新'}</span>
      </div>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      <HostSummary host={host} />
      <DiskList disks={snapshot.disk.data} />
      <GpuList gpus={host?.gpus ?? null} />
    </div>
  );
}
