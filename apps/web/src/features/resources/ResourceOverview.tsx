import { Activity, ChevronRight } from 'lucide-react';
import { useId } from 'react';
import type { ResourcesController } from './use-resources';
import { readingState, resourceTime } from './use-resources';
import type { ResourceHost, ResourceSnapshot } from '@ssh-server/shared';
import './resources.css';

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
        <span key={gpu.uuid} className="resource-overview-gpu resource-tone-gpu">
          <span>
            GPU {gpu.index} <strong className="resource-number">{percent(gpu.utilization)}</strong>
            <span className="sr-only"> 利用率</span>
          </span>
          <span className="resource-capacity text-muted-foreground">
            显存 {gib(gpu.memoryUsed)} / {gib(gpu.memoryTotal)} GiB
          </span>
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
    <span className="resource-overview-grid">
      <span className="resource-overview-stat resource-tone-cpu">
        <span className="text-muted-foreground">CPU 利用率</span>
        <span className="resource-number">{host?.cpuPercent == null ? 'CPU 不可用' : percent(host.cpuPercent)}</span>
      </span>
      <span className="resource-overview-stat">
        <span className="text-muted-foreground">内存（已用 / 总量）</span>
        <span className="resource-capacity font-medium">
          {gib(host?.memoryUsed)} / {gib(host?.memoryTotal)} GiB
        </span>
      </span>
      <GpuOverview gpus={host?.gpus} />
    </span>
  );
}
function HostIdentity({ snapshot }: { snapshot?: ResourceSnapshot }) {
  const hostname = snapshot?.host.data?.hostname ?? '不可用';
  return (
    <>
      <span className="min-w-0 truncate" title={hostname}>
        主机 {hostname}
      </span>
      <span>采样 {resourceTime(snapshot?.host.sampledAt)}</span>
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
  const id = useId();
  const { query, now, timing, pauseReason } = controller;
  const { stale, message } = readingState(query.data, query.error, now, timing.staleMs);
  const state = overviewState(controller, stale);
  return (
    <button
      type="button"
      aria-label="服务器资源详情"
      aria-describedby={`${id}-summary`}
      aria-expanded={opened}
      aria-haspopup="dialog"
      onClick={open}
      title={message ?? '查看实际SSH节点的资源详情'}
      className="resource-scope resource-overview"
    >
      <span className="resource-overview-heading">
        <span className="flex items-center gap-1.5 font-medium">
          <Activity aria-hidden className="size-4" />
          服务器资源
        </span>
        <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
      </span>
      <span id={`${id}-summary`}>
        <HostOverview snapshot={query.data} />
        <span className="resource-overview-footer">
          <HostIdentity snapshot={query.data} />
          <span
            role="status"
            className="resource-status"
            data-attention={stale}
            data-neutral={!!pauseReason || query.isLoading}
          >
            {state}
          </span>
        </span>
      </span>
    </button>
  );
}
