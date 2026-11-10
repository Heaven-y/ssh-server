import { Clock3, Gauge } from 'lucide-react';
import {
  averageTokenRate,
  finiteCount,
  formatDuration,
  formatTokens,
  generationTokenRate,
  tokenFields,
  type ChatStatistics,
} from './chat-metrics';

function Generation({ statistics }: { statistics: ChatStatistics }) {
  if (!statistics.generation || statistics.isError || statistics.scope !== 'step') return null;
  return (
    <>
      {finiteCount(statistics.generation.firstTokenMs) && (
        <span title="模型请求开始至首段输出，可包含推理输出">
          首段 {formatDuration(statistics.generation.firstTokenMs)}
        </span>
      )}
      <span title="CLI 报告的流式生成耗时，不含工具执行">生成 {formatDuration(statistics.generation.durationMs)}</span>
    </>
  );
}

function Rate({ statistics, label }: { statistics: ChatStatistics; label: string }) {
  const generated = generationTokenRate(statistics);
  const rate = generated ?? averageTokenRate(statistics);
  if (rate === undefined) return null;
  return (
    <span
      className="inline-flex items-center gap-1"
      title={
        generated !== undefined
          ? '同次生成的输出 token（含原生计入的推理）除以流式生成耗时，不含首段等待和工具执行'
          : `${label}输出 token 除以${label}总耗时，包含工具与等待时间`
      }
    >
      <Gauge aria-hidden className="size-3" />
      {generated !== undefined ? '生成' : label}平均 {rate.toFixed(1)} tok/s
    </span>
  );
}

/** 缺项直接省略；费用是 CLI 会话累计，不能混进这一行回合统计。 */
export function StatisticsLine({ statistics }: { statistics: ChatStatistics }) {
  const fields = tokenFields(statistics.usage);
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
      <Generation statistics={statistics} />
      {fields.map(({ label: field, value }) => (
        <span key={field}>
          {field} {formatTokens(value)}
        </span>
      ))}
      <Rate statistics={statistics} label={label} />
    </div>
  );
}
