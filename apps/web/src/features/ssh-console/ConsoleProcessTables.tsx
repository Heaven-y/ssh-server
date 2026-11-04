import type { SshConsoleGpuProcess, SshConsoleProcesses } from '@agentdeck/shared';
import { formatBytes, formatPercent } from './console-state';

const cell = 'border-b border-border px-3 py-2 text-left align-top';
function GpuProcesses({ data }: { data: SshConsoleProcesses }) {
  if (!data.gpuProcessesAvailable) return <p className="text-sm text-muted-foreground">GPU 进程信息不可用。</p>;
  if (!data.gpuProcesses.length) return <p className="text-sm text-muted-foreground">当前没有 GPU 进程。</p>;
  const groups = new Map<string, SshConsoleGpuProcess[]>();
  for (const process of data.gpuProcesses)
    groups.set(process.gpuUuid, [...(groups.get(process.gpuUuid) ?? []), process]);
  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([uuid, rows]) => (
        <section key={uuid} className="space-y-2">
          <h4 className="text-sm font-medium">
            GPU {rows[0]!.gpuIndex ?? uuid} · {rows.length} 个进程
          </h4>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full table-fixed text-xs">
              <caption className="sr-only">GPU {rows[0]!.gpuIndex ?? uuid} 进程</caption>
              <thead className="bg-muted">
                <tr>
                  <th className={`${cell} w-20`}>PID</th>
                  <th className={`${cell} w-28`}>用户</th>
                  <th className={`${cell} w-28`}>显存</th>
                  <th className={cell}>完整命令</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.pid}>
                    <td className={cell}>{row.pid}</td>
                    <td className={`${cell} break-all`}>{row.user ?? '不可用'}</td>
                    <td className={cell}>{formatBytes(row.memoryBytes)}</td>
                    <td className={`${cell} whitespace-pre-wrap break-all font-mono`}>{row.command ?? '不可用'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

export function ConsoleProcessTables({ data }: { data: SshConsoleProcesses }) {
  return (
    <div className="space-y-6">
      {data.message && (
        <p role="status" className="text-sm text-muted-foreground">
          {data.message}
        </p>
      )}
      {data.stale && <p className="text-sm text-warning">显示最近一次可用数据，当前采样已过期。</p>}
      {data.truncated && <p className="text-sm text-muted-foreground">进程较多，已达到本次显示上限。</p>}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">GPU 进程</h3>
        <GpuProcesses data={data} />
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Top 进程</h3>
        {!data.processes.length ? (
          <p className="text-sm text-muted-foreground">当前没有可显示的进程。</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full table-fixed text-xs">
              <caption className="sr-only">Top 进程</caption>
              <thead className="bg-muted">
                <tr>
                  <th className={`${cell} w-20`}>PID</th>
                  <th className={`${cell} w-28`}>用户</th>
                  <th className={`${cell} w-20`}>CPU</th>
                  <th className={`${cell} w-24`}>内存</th>
                  <th className={cell}>完整命令与状态</th>
                </tr>
              </thead>
              <tbody>
                {data.processes.map((row) => (
                  <tr key={row.pid}>
                    <td className={cell}>{row.pid}</td>
                    <td className={`${cell} break-all`}>{row.user}</td>
                    <td className={cell}>{formatPercent(row.cpuPercent)}</td>
                    <td className={cell}>
                      {formatBytes(row.memoryBytes)}
                      <span className="block text-muted-foreground">{formatPercent(row.memoryPercent)}</span>
                    </td>
                    <td className={cell}>
                      <p className="whitespace-pre-wrap break-all font-mono">{row.command}</p>
                      <p className="mt-1 break-all text-muted-foreground">
                        线程 {row.threads ?? '不可用'} · 时长 {row.elapsed} · 状态 {row.state} · PPID {row.ppid}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
