import { Clock3, Gauge } from 'lucide-react';
import {
  averageTokenRate,
  finiteCount,
  formatDuration,
  formatTokens,
  tokenFields,
  type ChatStatistics,
} from './chat-metrics';

/** 缺项直接省略；费用是 CLI 会话累计，不能混进这一行回合统计。 */
export function StatisticsLine({ statistics }: { statistics: ChatStatistics }) {
  const fields = tokenFields(statistics.usage);
  const rate = averageTokenRate(statistics);
  const duration = finiteCount(statistics.durationMs) ? statistics.durationMs : undefined;
  if (!fields.length && duration === undefined) return null;
  const label = statistics.scope === 'step' ? '步骤' : '回合';
  return (
    <div
      aria-label={`${label}统计`}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1 text-xs leading-5 text-muted-foreground"
    >
      {duration !== undefined && (
        <span
          className="inline-flex items-center gap-1"
          title={statistics.timingSource === 'observed' ? '工作台记录的耗时' : 'CLI 报告的耗时'}
        >
          <Clock3 aria-hidden className="size-3" />
          {formatDuration(duration)}
        </span>
      )}
      {fields.map(({ label: field, value }) => (
        <span key={field}>
          {field} {formatTokens(value)}
        </span>
      ))}
      {rate !== undefined && (
        <span
          className="inline-flex items-center gap-1"
          title={`${label}输出 token 除以${label}总耗时，包含工具与等待时间`}
        >
          <Gauge aria-hidden className="size-3" />
          {label}平均 {rate.toFixed(1)} tok/s
        </span>
      )}
    </div>
  );
}
