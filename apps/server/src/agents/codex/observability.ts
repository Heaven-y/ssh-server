import type { TokenUsage } from '@agentdeck/shared/conversation';
import { record, type RecordValue } from './types';

const USAGE_FIELDS = [
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
  'totalTokens',
] as const;
type UsageField = (typeof USAGE_FIELDS)[number];
export type CodexUsageBreakdown = Partial<Record<UsageField, number>>;

/** 原生 JSON 的 int64 只接受能精确表示的非负计数。 */
export function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function emptyCodexUsage(): CodexUsageBreakdown {
  return Object.fromEntries(USAGE_FIELDS.map((field) => [field, 0]));
}

function usageBreakdown(value: unknown): CodexUsageBreakdown | undefined {
  const input = record(value);
  const result: CodexUsageBreakdown = {};
  for (const field of USAGE_FIELDS) {
    const count = nonnegativeInteger(input[field]);
    if (count !== undefined) result[field] = count;
  }
  return Object.keys(result).length ? result : undefined;
}

function decreased(current: CodexUsageBreakdown, previous: CodexUsageBreakdown): boolean {
  return USAGE_FIELDS.some((field) => {
    const now = current[field];
    const before = previous[field];
    return now !== undefined && before !== undefined && now < before;
  });
}

export function updateCodexUsageBaseline(
  previous: CodexUsageBreakdown | undefined,
  value: unknown,
): CodexUsageBreakdown | undefined {
  const current = usageBreakdown(value);
  return current && !(previous && decreased(current, previous)) ? current : undefined;
}

/** 一轮内只保留最新累计快照；恢复、缺字段或计数重置不能变成本轮增量。 */
export class CodexTurnUsage {
  private baseline?: CodexUsageBreakdown;
  private latest?: CodexUsageBreakdown;
  private known?: CodexUsageBreakdown;
  private discontinuous = false;

  begin(baseline?: CodexUsageBreakdown): void {
    this.baseline = baseline;
    this.known = baseline;
    this.latest = undefined;
    this.discontinuous = false;
  }

  observe(value: unknown): void {
    const current = usageBreakdown(value);
    if (!current || (this.known && decreased(current, this.known))) this.discontinuous = true;
    this.known = { ...this.known, ...current };
    this.latest = current;
  }

  snapshot(): CodexUsageBreakdown | undefined {
    return this.latest ? { ...this.latest } : undefined;
  }

  invalidate(): void {
    this.discontinuous = true;
  }

  requireFreshSnapshot(): void {
    this.latest = undefined;
  }

  result(): TokenUsage | undefined {
    if (!this.baseline || !this.latest || this.discontinuous) return;
    const diff: CodexUsageBreakdown = {};
    for (const field of USAGE_FIELDS) {
      const value = this.latest[field];
      const previous = this.baseline[field];
      if (value !== undefined && previous !== undefined) diff[field] = value - previous;
    }
    return Object.keys(diff).length ? { source: 'codex', scope: 'turn', ...diff } : undefined;
  }
}

/** 优先采用原生执行耗时；没有时只使用同条目的完整起止时间。 */
export function codexItemDuration(item: RecordValue): { durationMs?: number; timingSource?: 'native' } {
  const duration = nonnegativeInteger(item.durationMs);
  if (duration !== undefined) return { durationMs: duration, timingSource: 'native' };
  const started = nonnegativeInteger(item.startedAtMs);
  const completed = nonnegativeInteger(item.completedAtMs);
  if (started === undefined || completed === undefined || completed < started) return {};
  return { durationMs: completed - started, timingSource: 'native' };
}
