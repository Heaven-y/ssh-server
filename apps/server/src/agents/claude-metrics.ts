import type { AgentEvent, TokenUsage } from '@agentdeck/shared';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};

export const nonnegative = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** result.usage 是主循环本轮统计；modelUsage 和费用的累计值不并入。 */
export function claudeTokenUsage(value: unknown): TokenUsage | undefined {
  const usage = record(value);
  const fields = {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.cache_read_input_tokens,
    cacheWriteInputTokens: usage.cache_creation_input_tokens,
    reasoningOutputTokens: record(usage.output_tokens_details).thinking_tokens,
    totalTokens: usage.total_tokens,
  };
  const counts = Object.entries(fields).filter(([, count]) => Number.isSafeInteger(count) && Number(count) >= 0);
  return counts.length ? { source: 'claude', scope: 'turn', ...Object.fromEntries(counts) } : undefined;
}

/** 同一工具只开始一次；历史不用本机接收时间补造耗时。 */
export class ClaudeToolMetrics {
  private readonly started = new Map<string, number>();
  private readonly completed = new Set<string>();

  reset() {
    this.started.clear();
    this.completed.clear();
  }

  observe(event: AgentEvent): AgentEvent[] {
    if (event.type === 'tool_call') {
      if (this.started.has(event.id)) return [];
      this.started.set(event.id, performance.now());
    }
    if (event.type === 'tool_result') {
      if (this.completed.has(event.id)) return [];
      this.completed.add(event.id);
      const started = this.started.get(event.id);
      if (started !== undefined)
        return [{ ...event, durationMs: Math.max(0, performance.now() - started), timingSource: 'observed' }];
    }
    return [event];
  }
}

export function claudeToolProgress(message: RecordValue): AgentEvent[] {
  const seconds = nonnegative(message.elapsed_time_seconds);
  if (typeof message.tool_use_id !== 'string' || seconds === undefined) return [];
  return [{ type: 'tool_progress', id: message.tool_use_id, durationMs: seconds * 1000 }];
}
