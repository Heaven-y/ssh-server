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

/** 只允许投递一次；保留 stdin 到 summary 读取结束，close 同时释放未投递和已投递的等待。 */
export function createClaudeInput() {
  let begin!: (message: SDKUserMessage | undefined) => void;
  let finish!: () => void;
  let sent = false;
  let closed = false;
  const first = new Promise<SDKUserMessage | undefined>((resolve) => {
    begin = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const prompt = (async function* () {
    const message = await first;
    if (message) {
      yield message;
      await completed;
    }
  })();
  return {
    prompt,
    send(text: string) {
      if (sent || closed) throw new Error('Claude 单轮输入已经关闭或投递');
      sent = true;
      begin({
        type: 'user',
        message: { role: 'user', content: text },
        session_id: '',
        parent_tool_use_id: null,
        uuid: randomUUID(),
      });
    },
    close() {
      closed = true;
      begin(undefined);
      finish();
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
