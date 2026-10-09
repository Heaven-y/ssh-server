import { RefreshCw } from 'lucide-react';
import type { SlurmSnapshot, TerminalTarget } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { useSlurm } from './use-slurm';

function JobsResult({ data }: { data: SlurmSnapshot }) {
  if (data.status !== 'available')
    return (
      <p
        role="status"
        className={data.status === 'error' ? 'text-sm text-destructive-foreground' : 'text-sm text-muted-foreground'}
      >
        {data.message ??
          (data.status === 'unavailable'
            ? '未找到 squeue，请确认服务器已安装 Slurm。'
            : 'Slurm查询失败，请检查连接后重试。')}
      </p>
    );
  return (
    <>
      {data.message && (
        <p role="status" className="text-sm leading-6 text-warning">
          {data.message}
        </p>
      )}
      {data.output ? (
        <pre
          role="region"
          aria-label="当前账号作业输出"
          tabIndex={0}
          className="max-h-[480px] w-full min-w-0 max-w-full overflow-auto rounded-lg border border-border/70 bg-background/50 p-3 font-mono text-xs leading-5 whitespace-pre focus-visible:outline-2 focus-visible:outline-accent"
        >
          {data.output}
        </pre>
      ) : (
        <p className="text-sm text-muted-foreground">{data.message ? '本次查询没有返回内容' : '暂无作业'}</p>
      )}
      {data.truncated && <p className="mt-2 text-xs text-muted-foreground">仅显示前200行</p>}
    </>
  );
}
export function SlurmJobs({ target, active }: { target: TerminalTarget; active: boolean }) {
  const query = useSlurm(target, active);
  return (
    <section aria-label="Slurm作业" className="min-w-0 max-w-full space-y-3 border-t border-border/70 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Slurm作业</h3>
        <button
          type="button"
          className={buttonClass('ghost')}
          aria-label="刷新作业"
          disabled={!active || query.loading}
          onClick={query.refresh}
        >
          <RefreshCw aria-hidden className={`size-3.5 ${query.loading ? 'motion-safe:animate-spin' : ''}`} />
          刷新
        </button>
      </div>
      <p className="text-xs text-muted-foreground">当前账号</p>
      <p className="text-xs text-muted-foreground">
        作业更新：{query.data ? new Date(query.data.sampledAt).toLocaleTimeString('zh-CN') : '尚未读取'}
      </p>
      {query.loading && (
        <p role="status" className="text-xs text-muted-foreground">
          正在读取作业…
        </p>
      )}
      {query.error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {query.error}
        </p>
      )}
      {query.data && <JobsResult data={query.data} />}
    </section>
  );
}
