import type { AgentEvent, TokenUsage } from '@agentdeck/shared/conversation';
import { managementObject as object } from './management-rpc';

export const nonnegative = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

function tokenCount(value: unknown): number | undefined {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof numeric === 'number' && Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

/** 原生 JSON 的 uint64 可能是字符串；缺字段不填零，也不合并可能重叠的分项。 */
export function stepUsage(value: unknown, headless = false): TokenUsage | undefined {
  const source = object(value);
  const fields: Record<string, string> = headless
    ? {
        inputTokens: 'input_tokens',
        outputTokens: 'output_tokens',
        cachedInputTokens: 'cache_read_tokens',
        reasoningOutputTokens: 'thinking_tokens',
        totalTokens: 'total_tokens',
      }
    : {
        inputTokens: 'inputTokens',
        outputTokens: 'outputTokens',
        cachedInputTokens: 'cacheReadTokens',
        cacheWriteInputTokens: 'cacheWriteTokens',
        reasoningOutputTokens: 'thinkingOutputTokens',
      };
  const counts = Object.fromEntries(
    Object.entries(fields).flatMap(([key, native]) => {
      const number = tokenCount(source[native]);
      return number === undefined ? [] : [[key, number]];
    }),
  );
  return Object.keys(counts).length ? { ...counts, source: 'antigravity', scope: 'step' } : undefined;
}

export function stepDuration(seconds: unknown): { durationMs?: number; timingSource?: 'native' } {
  const duration = nonnegative(seconds);
  const milliseconds = duration === undefined ? undefined : nonnegative(duration * 1000);
  return milliseconds === undefined ? {} : { durationMs: milliseconds, timingSource: 'native' };
}

function timestamp(value: unknown): number | undefined {
  if (typeof value === 'string') return nonnegative(Date.parse(value));
  const parts = object(value);
  const seconds = tokenCount(parts.seconds);
  const nanos = tokenCount(parts.nanos) ?? 0;
  return seconds === undefined || nanos >= 1e9 ? undefined : nonnegative(seconds * 1000 + nanos / 1e6);
}

export function historyTiming(value: unknown): { durationMs?: number; timingSource?: 'native' } {
  const metadata = object(value);
  const start = timestamp(metadata.startedAt);
  const end = timestamp(metadata.completedAt);
  if (start === undefined || end === undefined || end < start) return {};
  return { durationMs: end - start, timingSource: 'native' };
}

export function contextEvent(value: unknown): AgentEvent[] {
  const context = object(value);
  const used = tokenCount(context.estimatedTokensUsed);
  if (used === undefined) return [];
  const window = tokenCount(context.maxContextTokens);
  return [
    {
      type: 'context',
      usage: {
        usedTokens: used,
        source: 'antigravity_estimate',
        ...(window ? { windowTokens: window, percentage: (used / window) * 100 } : {}),
      },
    },
  ];
}
