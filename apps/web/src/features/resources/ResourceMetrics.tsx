import type { ResourceHost, ResourceDisk } from '@ssh-server/shared';
import { ResourceMeter, capacityPercent } from './ResourceMeter';

const decimal = (value: number | null, unit: string) => (value === null ? '不可用' : `${value.toFixed(1)}${unit}`);
function size(value: number | null): string {
  if (value === null) return '不可用';
  const unit = value >= 1024 ** 3 ? 'GiB' : 'MiB';
  return `${(value / (unit === 'GiB' ? 1024 ** 3 : 1024 ** 2)).toFixed(1)} ${unit}`;
}
const capacity = (used: number | null, total: number | null) => `${size(used)} / ${size(total)}`;
function Metric({
  label,
  value,
  percent,
  tone = 'cpu',
}: {
  label: string;
  value: string;
  percent?: number | null;
  tone?: 'cpu' | 'memory';
}) {
  return (
    <div className={`resource-metric-card resource-tone-${tone}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`resource-capacity mt-2 ${tone === 'cpu' && percent !== undefined ? 'resource-number text-xl' : 'text-sm'}`}
      >
        {value}
        {percent !== undefined && (
          <span className="mt-2 block">
            <ResourceMeter label={label} value={percent} tone={tone} />
          </span>
        )}
      </dd>
    </div>
  );
}

const EMPTY_HOST: ResourceHost = {
  hostname: null,
  cpuPercent: null,
  load: null,
  memoryUsed: null,
  memoryTotal: null,
  gpus: null,
  processes: null,
  gpuProcessesAvailable: false,
};

function ResourceSummary({ host, disk }: { host: ResourceHost; disk: ResourceDisk | null }) {
  return (
    <dl className="grid grid-cols-2 gap-3">
      <Metric label="CPU利用率" value={decimal(host.cpuPercent, '%')} percent={host.cpuPercent} />
      <Metric
        label="负载（1 / 5 / 15分钟）"
        value={host.load?.map((value) => value.toFixed(2)).join(' / ') ?? '不可用'}
      />
      <Metric
        label="内存（已用 / 总量）"
        value={capacity(host.memoryUsed, host.memoryTotal)}
        percent={capacityPercent(host.memoryUsed, host.memoryTotal)}
        tone="memory"
      />
      <Metric
        label="项目磁盘（可用 / 总量）"
        value={capacity(disk?.availableBytes ?? null, disk?.totalBytes ?? null)}
      />
    </dl>
  );
}
function GpuList({ gpus }: { gpus: ResourceHost['gpus'] }) {
  if (gpus?.length === 0)
    return (
      <section>
        <h3 className="mb-2 text-sm font-semibold">GPU</h3>
        <p className="text-sm text-muted-foreground">未检测到GPU</p>
      </section>
    );
  return (
    <section aria-labelledby="resource-gpus">
      <h3 id="resource-gpus" className="mb-2 text-sm font-semibold">
        GPU
      </h3>
      {gpus ? (
        <div className="space-y-2">
          {gpus.map((gpu) => (
            <div key={gpu.uuid} className="resource-metric-card resource-gpu-card resource-tone-gpu">
              <p className="break-words text-sm font-medium">
                GPU {gpu.index} · {gpu.name}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div className="min-w-0">
                  <dt className="text-muted-foreground">利用率</dt>
                  <dd className="resource-number mt-1 text-xl">
                    {decimal(gpu.utilization, '%')}
                    <span className="mt-2 block">
                      <ResourceMeter label={`GPU ${gpu.index} 利用率`} value={gpu.utilization} tone="gpu" />
                    </span>
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground">显存（已用 / 总量）</dt>
                  <dd className="resource-capacity mt-1 text-sm font-medium">
                    {capacity(gpu.memoryUsed, gpu.memoryTotal)}
                    <span className="mt-2 block">
                      <ResourceMeter
                        label={`GPU ${gpu.index} 显存占用`}
                        value={capacityPercent(gpu.memoryUsed, gpu.memoryTotal)}
                        tone="memory"
                      />
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">温度</dt>
                  <dd>{decimal(gpu.temperature, ' °C')}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">功耗</dt>
                  <dd>{decimal(gpu.power, ' W')}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">不可用：节点没有可读取的GPU指标。</p>
      )}
    </section>
  );
}
function gpuName(host: ResourceHost, uuid: string) {
  const gpu = host.gpus?.find((item) => item.uuid === uuid);
  return gpu ? `GPU ${gpu.index}` : uuid.slice(0, 12);
}
function ProcessTable({ host }: { host: ResourceHost }) {
  return (
    <section aria-labelledby="resource-processes">
      <h3 id="resource-processes" className="text-sm font-semibold">
        节点进程
      </h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        按CPU排序，最多50条。共享账号下无法据此判断进程归属；这里不标记工作区任务。GPU关联
        {host.gpuProcessesAvailable ? '仅来自实际计算进程记录' : '不可用'}。
      </p>
      {host.processes ? (
        <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr>
                {['PID', '命令', 'CPU', '内存', 'GPU / 显存'].map((label) => (
                  <th key={label} scope="col" className="whitespace-nowrap p-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {host.processes.map((process) => (
                <tr key={process.pid} className="border-t border-border">
                  <td className="p-2 font-mono">{process.pid}</td>
                  <td className="max-w-40 break-words p-2">{process.command}</td>
                  <td className="whitespace-nowrap p-2">{decimal(process.cpuPercent, '%')}</td>
                  <td className="whitespace-nowrap p-2">{size(process.memoryBytes)}</td>
                  <td className="p-2">
                    {process.gpus.length
                      ? process.gpus.map((gpu) => `${gpuName(host, gpu.uuid)} / ${size(gpu.memoryBytes)}`).join('；')
                      : host.gpuProcessesAvailable
                        ? '未记录'
                        : '不可用'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">进程信息不可用。</p>
      )}
    </section>
  );
}
export function ResourceMetrics({ host, disk }: { host: ResourceHost | null; disk: ResourceDisk | null }) {
  const data = host ?? EMPTY_HOST;
  return (
    <div className="resource-scope space-y-5">
      <ResourceSummary host={data} disk={disk} />
      <GpuList gpus={data.gpus} />
      <ProcessTable host={data} />
    </div>
  );
}
