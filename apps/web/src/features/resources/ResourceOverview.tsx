import { Activity } from 'lucide-react';
import type { ResourcesController } from './use-resources';
import { readingState, resourceTime } from './use-resources';
import type { ResourceHost, ResourceSnapshot } from '@ssh-server/shared';

const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? '不可用' : `${value.toFixed(0)}%`;
const gib = (value: number | null | undefined) =>
  value === null || value === undefined ? '不可用' : `${(value / 1024 ** 3).toFixed(1)}`;
function GpuOverview({ gpus }: { gpus: ResourceHost['gpus'] | undefined }) {
  if (!gpus) return <span>GPU 不可用</span>;
  if (!gpus.length) return <span>未检测到GPU</span>;
  return (
    <>
      {gpus.slice(0, 2).map((gpu) => (
        <span key={gpu.uuid}>
          GPU {gpu.index} {percent(gpu.utilization)} · {gib(gpu.memoryUsed)}/{gib(gpu.memoryTotal)} GiB
        </span>
      ))}
      {gpus.length > 2 && <span>另 {gpus.length - 2} 张GPU</span>}
    </>
  );
}
function overviewState(controller: ResourcesController, stale: boolean) {
  if (controller.pauseReason) return controller.pauseReason;
  if (controller.query.isLoading) return '正在读取';
  return stale ? '过期 / 不可用' : '采样有效';
}
function HostOverview({ snapshot }: { snapshot?: ResourceSnapshot }) {
  const host = snapshot?.host.data;
  return (
    <>
      <span className="flex items-center gap-1.5">
        <Activity aria-hidden className="size-4" />
        CPU {percent(host?.cpuPercent)}
      </span>
      <span>
        内存 {gib(host?.memoryUsed)}/{gib(host?.memoryTotal)} GiB
      </span>
      <GpuOverview gpus={host?.gpus} />
    </>
  );
}
function HostIdentity({ snapshot }: { snapshot?: ResourceSnapshot }) {
  const hostname = snapshot?.host.data?.hostname ?? '不可用';
  return (
    <>
      <span className="max-w-32 truncate text-muted-foreground" title={hostname}>
        主机 {hostname}
      </span>
      <span className="text-muted-foreground">{resourceTime(snapshot?.host.sampledAt)}</span>
    </>
  );
}
export function ResourceOverview({
  controller,
  opened,
  open,
}: {
  controller: ResourcesController;
  opened: boolean;
  open(): void;
}) {
  const { query, now, timing, pauseReason } = controller;
  const { stale, message } = readingState(query.data, query.error, now, timing.staleMs);
  const state = overviewState(controller, stale);
  return (
    <button
      type="button"
      aria-label="服务器资源详情"
      aria-expanded={opened}
      aria-haspopup="dialog"
      onClick={open}
      title={message ?? '查看实际SSH节点的资源详情'}
      className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent 2xl:w-auto"
    >
      <HostOverview snapshot={query.data} />
      <HostIdentity snapshot={query.data} />
      <span role="status" className={stale || pauseReason ? 'text-warning' : 'text-success'}>
        {state}
      </span>
    </button>
  );
}
