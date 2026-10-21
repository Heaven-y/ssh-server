import { randomUUID } from 'node:crypto';
import { query, type Options, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ContextUsage } from '@ssh-server/shared';
import { resolveClaudeExecutable } from './claude-launch';

/** 固定SDK的控制契约；只收窄消息迭代内容，由映射器校验原生事件。 */
export type ClaudeQuery = AsyncIterable<unknown> &
  Pick<Query, 'interrupt' | 'close' | 'supportedCommands' | 'supportedModels' | 'getContextUsage'>;
export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => ClaudeQuery;
export const nativeClaudeQuery: QueryFn = (params) =>
  query({
    ...params,
    options: {
      ...params.options,
      pathToClaudeCodeExecutable: params.options.pathToClaudeCodeExecutable ?? resolveClaudeExecutable(),
    },
  });
export const CLAUDE_CONTROL_TIMEOUT_MS = 10_000;
export const CLAUDE_SUMMARY_TIMEOUT_MS = 3_000;

/**
 * 长驻输入流：进程存活期间可反复投递消息，close 结束输入并让原生进程退出。
 * 与单轮 createClaudeInput 不同，这里不限制投递次数。
 */
export function createClaudeStream() {
  const queue: SDKUserMessage[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const prompt = (async function* () {
    while (!closed) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
  })();
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  return {
    prompt,
    send(text: string) {
      if (closed) throw new Error('Claude 输入流已关闭');
      queue.push({
        type: 'user',
        message: { role: 'user', content: text },
        session_id: '',
        parent_tool_use_id: null,
        uuid: randomUUID(),
      });
      notify();
    },
    close() {
      if (closed) return;
      closed = true;
      notify();
    },
  };
}

export function claudeControl<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  timeoutMs = CLAUDE_CONTROL_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error('Claude 原生接口请求失败'));
    };
    const cancel = () => fail(new Error('Claude 操作已取消'));
    const timer = setTimeout(() => fail(new Error('Claude 原生接口响应超时')), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    promise.then((value) => {
      cleanup();
      resolve(value);
    }, fail);
    if (signal?.aborted) cancel();
  });
}

const nonNegative = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
/** 不从模型名称、费用或累计 token 推算当前占用。 */
export function claudeContextUsage(value: unknown): ContextUsage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const usedTokens = nonNegative(raw.totalTokens);
  if (usedTokens === undefined) return null;
  const windowTokens = nonNegative(raw.rawMaxTokens);
  return {
    usedTokens,
    windowTokens: windowTokens && windowTokens > 0 ? windowTokens : undefined,
    percentage: nonNegative(raw.percentage),
    model: typeof raw.model === 'string' ? raw.model : undefined,
    source: 'claude_estimate',
  };
}

export async function readClaudeContext(q: ClaudeQuery, signal?: AbortSignal): Promise<ContextUsage | null> {
  try {
    return claudeContextUsage(
      await claudeControl(q.getContextUsage({ detail: 'summary' }), signal, CLAUDE_SUMMARY_TIMEOUT_MS),
    );
  } catch {
    return null;
  }
}
