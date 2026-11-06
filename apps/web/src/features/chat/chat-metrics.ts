import type { TokenUsage } from '@agentdeck/shared';

export type ChatStatistics = {
  scope: 'turn' | 'step';
  durationMs?: number;
  timingSource?: 'native' | 'observed';
  usage?: TokenUsage;
  isError?: boolean;
};

export const finiteCount = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0;

export const formatTokens = (value: number) => new Intl.NumberFormat('zh-CN').format(value);

export function formatDuration(value: number): string {
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.floor(value / 60_000)} min ${Math.round((value % 60_000) / 1000)} s`;
}

/** 只将同范围的原生输出量与耗时配对；不从文字长度补造 token。 */
export function averageTokenRate(statistics: ChatStatistics): number | undefined {
  const { usage, durationMs, isError, scope } = statistics;
  if (isError || !usage || usage.scope !== scope || !finiteCount(durationMs) || durationMs === 0) return;
  if (!finiteCount(usage.outputTokens)) return;
  const rate = (usage.outputTokens * 1000) / durationMs;
  return Number.isFinite(rate) ? rate : undefined;
}

export function tokenFields(usage?: TokenUsage): Array<{ label: string; value: number }> {
  if (!usage) return [];
  const fields = [
    ['输入', usage.inputTokens],
    ['输出', usage.outputTokens],
    ['缓存读取', usage.cachedInputTokens],
    ['缓存写入', usage.cacheWriteInputTokens],
    ['推理', usage.reasoningOutputTokens],
  ] as const;
  const present = fields.flatMap(([label, value]) => (finiteCount(value) ? [{ label, value }] : []));
  return present.length || !finiteCount(usage.totalTokens) ? present : [{ label: '用量', value: usage.totalTokens }];
}
