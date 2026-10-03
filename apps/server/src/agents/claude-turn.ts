import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@ssh-server/shared';
import type { AgentTurnInput, TurnHandle } from './types';
import { claudeInvocationText } from './claude-capabilities';
import { ClaudeCompactionTracker } from './claude-compaction';
import { ClaudeEventMapper } from './claude-mapper';
import {
  claudeControl,
  createClaudeInput,
  nativeClaudeQuery,
  readClaudeContext,
  type ClaudeQuery,
  type QueryFn,
} from './claude-query';

const ABORT_FALLBACK_MS = 5_000;
const COMPACTION_EVENTS = new Set<AgentEvent['type']>(['session', 'context', 'compaction', 'turn_end', 'error']);
type Input = AgentTurnInput & { queryFn?: QueryFn };
const commandIs = (input: Input, name: 'context' | 'compact') =>
  input.invocation?.kind === 'command' && input.invocation.name === name;
const isResult = (message: unknown): boolean =>
  !!message &&
  typeof message === 'object' &&
  'type' in message &&
  message.type === 'result' &&
  !('parent_tool_use_id' in message && message.parent_tool_use_id);

function requireSession(input: Input) {
  if (input.invocation?.kind === 'command' && !input.sessionId) throw new Error('此 Claude 命令需要已有会话');
}

/** 每轮只投递一个输入，控制请求和普通消息共享同一原生实例与退出边界。 */
export function runClaudeQuery(input: Input, options: Options, controller: AbortController): TurnHandle {
  const messages = createClaudeInput();
  const manual = commandIs(input, 'compact');
  const compaction = new ClaudeCompactionTracker(manual);
  let q: ClaudeQuery | undefined;
  let phase: 'preparing' | 'running' | 'summary' | 'finished' = 'preparing';
  let interrupted = false;
  let ended = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    messages.close();
    q?.close?.();
  };

  function emit(event: AgentEvent) {
    // 手动压缩是控制操作，原生保留/重放的对话不能作为本轮新增内容。
    if (manual && !COMPACTION_EVENTS.has(event.type)) return;
    if (event.type === 'compaction') {
      const state = compaction.observe(event.state, interrupted);
      if (state) input.emit({ type: 'compaction', state });
      return;
    }
    if (event.type === 'turn_end') {
      ended = true;
      input.emit({ ...event, isError: event.isError || compaction.manualFailed || interrupted });
      return;
    }
    input.emit(event);
  }
  function finishCompaction() {
    const state = compaction.finish(interrupted);
    if (state) input.emit({ type: 'compaction', state });
  }
  async function context(query: ClaudeQuery) {
    phase = 'summary';
    const usage = await readClaudeContext(query, controller.signal);
    input.emit({ type: 'context', usage });
    emit({ type: 'turn_end', isError: usage === null });
  }
  async function consume(query: ClaudeQuery) {
    const mapper = new ClaudeEventMapper();
    for await (const message of query) {
      if (isResult(message)) {
        phase = 'summary';
        const usage = await readClaudeContext(query, controller.signal);
        input.emit({ type: 'context', usage });
        finishCompaction();
        mapper.map(message).forEach(emit);
        close();
        break;
      }
      mapper.map(message).forEach(emit);
    }
  }
  const done = (async () => {
    try {
      requireSession(input);
      q = (input.queryFn ?? nativeClaudeQuery)({ prompt: messages.prompt, options });
      if (commandIs(input, 'context')) {
        await context(q);
      } else {
        const text = await claudeInvocationText(q, input.invocation, input.text, controller.signal);
        if (controller.signal.aborted) throw new Error('Claude 操作已取消');
        phase = 'running';
        messages.send(text);
        await consume(q);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        input.emit({ type: 'error', message: error instanceof Error ? error.message : 'Claude 本轮运行失败' });
    } finally {
      finishCompaction();
      if (!ended) emit({ type: 'turn_end', isError: true });
      clearTimeout(fallback);
      close();
      phase = 'finished';
    }
  })();

  return {
    done,
    async interrupt() {
      if (phase === 'finished') return;
      interrupted = true;
      if (phase !== 'running' || !q) {
        controller.abort();
        close();
        return;
      }
      try {
        await claudeControl(q.interrupt(), undefined, ABORT_FALLBACK_MS);
      } catch {
        controller.abort();
        close();
        return;
      }
      if (ended) return;
      fallback = setTimeout(() => {
        if (phase !== 'finished') {
          controller.abort();
          close();
        }
      }, ABORT_FALLBACK_MS);
      fallback.unref?.();
    },
  };
}
