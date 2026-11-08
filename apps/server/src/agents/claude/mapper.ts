// 把 Claude Agent SDK 的消息转换成统一的 AgentEvent
import { NativeSessionIdSchema, type AgentEvent } from '@agentdeck/shared/conversation';
import { claudeCompactionBoundary, claudeCompactionStatus, ClaudeReplayFilter } from './compaction';
import {
  claudeHistoryUsage,
  claudeTokenUsage,
  ClaudeToolMetrics,
  claudeToolProgress,
  nonnegative as num,
} from './metrics';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const TERMINAL_STOPS = new Set(['end_turn', 'stop_sequence', 'max_tokens', 'refusal', 'model_context_window_exceeded']);
type MessageIdentity = { sessionId: string; pointId: string };
const isChild = (message: Rec) => !!message.parent_tool_use_id || !!message.parent_agent_id;

type HistoryBlock = { id?: string; events: AgentEvent[] };
type HistoryUsage = { position: number; event: Extract<AgentEvent, { type: 'step_usage' }> };
function historyMessageId(message: unknown): string | undefined {
  if (!isRec(message) || isChild(message) || message.type !== 'assistant' || !isRec(message.message)) return;
  return message.message.model === '<synthetic>' ? undefined : str(message.message.id) || undefined;
}

/** 最后一个可显示内容块决定统计位置；缺失/无效的新用量不能吞掉此前有效报告。 */
function historyUsagePositions(blocks: HistoryBlock[]): Map<string, HistoryUsage> {
  const statistics = new Map<string, HistoryUsage>();
  blocks.forEach((block, position) => {
    if (!block.id || !block.events.length) return;
    const event = block.events.find((value) => value.type === 'step_usage') ?? statistics.get(block.id)?.event;
    if (event) statistics.set(block.id, { position, event });
  });
  return statistics;
}

function withHistoryUsage(block: HistoryBlock, position: number, statistics: Map<string, HistoryUsage>): AgentEvent[] {
  const events: AgentEvent[] = block.events.filter((event) => event.type !== 'step_usage');
  const usage = block.id ? statistics.get(block.id) : undefined;
  if (usage?.position !== position) return events;
  const end = events.findIndex((event) => event.type === 'turn_end');
  events.splice(end < 0 ? events.length : end, 0, usage.event);
  return events;
}

function assistantIdentity(msg: Rec): MessageIdentity | undefined {
  if (msg.type !== 'assistant' || msg.parent_tool_use_id || msg.parent_agent_id || msg.aborted) return;
  if (blocksOf(msg).some((block) => isRec(block) && block.type === 'tool_use')) return;
  const session = NativeSessionIdSchema.safeParse(msg.session_id);
  const point = NativeSessionIdSchema.safeParse(msg.uuid);
  return session.success && point.success ? { sessionId: session.data, pointId: point.data } : undefined;
}

/** 历史只采用原生终止标记；工具调用与未完成流不能充当已结束位置。 */
export function claudeHistoryForkPoint(message: unknown, sessionId?: string): string | undefined {
  if (!isRec(message) || !isRec(message.message)) return;
  const identity = assistantIdentity(message);
  if (!identity || (sessionId !== undefined && identity.sessionId !== sessionId)) return;
  return TERMINAL_STOPS.has(str(message.message.stop_reason) ?? '') ? identity.pointId : undefined;
}

/** tool_result 内容的最大长度（字符），超出部分截掉 */
export const TOOL_OUTPUT_MAX_CHARS = 20_000;

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!isRec(part)) return '';
      if (part.type === 'text') return str(part.text) ?? '';
      if (part.type === 'image') return '[图片]';
      return '';
    })
    .join('\n');
}

function truncate(s: string): string {
  if (s.length <= TOOL_OUTPUT_MAX_CHARS) return s;
  return `${s.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[已截断，共 ${s.length} 字符]`;
}

function blocksOf(msg: Rec): unknown[] {
  const inner = isRec(msg.message) ? msg.message : undefined;
  const content = inner?.content;
  return Array.isArray(content) ? content : [];
}

function sessionEvent(msg: Rec): AgentEvent[] {
  if (msg.subtype !== 'init') return [];
  return [
    { type: 'session', sessionId: str(msg.session_id) ?? '', model: str(msg.model) ?? '', cwd: str(msg.cwd) ?? '' },
  ];
}

function turnEndEvent(msg: Rec, forkPoint?: string): AgentEvent[] {
  const failedSubtype = typeof msg.subtype === 'string' && msg.subtype !== 'success';
  const usage = claudeTokenUsage(msg.usage);
  return [
    {
      type: 'turn_end',
      isError: msg.is_error === true || failedSubtype,
      durationMs: num(msg.duration_ms),
      costUsd: num(msg.total_cost_usd),
      ...(usage ? { usage } : {}),
      ...(forkPoint ? { forkPoint } : {}),
    },
  ];
}

/** 用户消息中的纯文本（字符串内容或 text 块） */
function userTexts(msg: Rec): AgentEvent[] {
  const inner = isRec(msg.message) ? msg.message : undefined;
  if (typeof inner?.content === 'string') return [{ type: 'user_message', text: inner.content }];
  return blocksOf(msg).flatMap((b): AgentEvent[] => {
    const text = isRec(b) && b.type === 'text' ? str(b.text) : undefined;
    return text ? [{ type: 'user_message', text }] : [];
  });
}

/** content_block_delta 中的文本或思考增量 */
function deltaEvent(d: Rec): AgentEvent | undefined {
  const text = d.type === 'text_delta' ? str(d.text) : undefined;
  if (text) return { type: 'text', delta: text };
  const thinking = d.type === 'thinking_delta' ? str(d.thinking) : undefined;
  return thinking ? { type: 'reasoning', delta: thinking } : undefined;
}

/** 工具与两种公开文本各自去重，未流式传递的 thinking 块仍可回放。 */
function assistantBlock(b: unknown, includeText: boolean, includeThinking: boolean): AgentEvent[] {
  if (!isRec(b)) return [];
  if (b.type === 'tool_use')
    return [{ type: 'tool_call', id: str(b.id) ?? '', name: str(b.name) ?? '', input: b.input }];
  if (includeThinking && b.type === 'thinking') return thinkingBlock(b);
  const text = b.type === 'text' ? str(b.text) : undefined;
  return text && includeText ? [{ type: 'text', delta: text }] : [];
}
function thinkingBlock(block: Rec): AgentEvent[] {
  const delta = str(block.thinking);
  return delta ? [{ type: 'reasoning', delta }] : [];
}
/** 长驻运行时每轮重置去重与计时；历史读取使用独立实例。 */
export class ClaudeEventMapper {
  private replay = new ClaudeReplayFilter();
  /** 已经收到过 text_delta 的消息 id */
  private streamed = new Set<string>();
  private streamedThinking = new Set<string>();
  private currentMessageId: string | undefined;
  /** 没有消息 id 时的退路：本轮是否收到过 text_delta */
  private anyDelta = false;
  private anyThinkingDelta = false;
  private lastAssistant?: MessageIdentity;
  private readonly tools = new ClaudeToolMetrics();

  constructor(private readonly historySessionId?: string) {}

  beginTurn(): void {
    this.tools.reset();
    this.streamed.clear();
    this.streamedThinking.clear();
    this.currentMessageId = undefined;
    this.anyDelta = false;
    this.anyThinkingDelta = false;
    this.lastAssistant = undefined;
  }

  map(msg: unknown): AgentEvent[] {
    // 子代理的消息不在 M1 中展示
    if (!isRec(msg) || isChild(msg)) return [];
    if (this.replay.skip(msg)) return [];
    if (msg.type === 'tool_progress') return claudeToolProgress(msg);
    switch (msg.type) {
      case 'system':
        return [...sessionEvent(msg), ...claudeCompactionBoundary(msg), ...claudeCompactionStatus(msg)];
      case 'stream_event':
        return this.streamEvent(msg.event);
      case 'assistant':
        this.lastAssistant = assistantIdentity(msg);
        return this.assistant(msg, false);
      case 'user':
        this.lastAssistant = undefined;
        return this.toolResults(msg);
      case 'result':
        return this.end(msg);
      default:
        return [];
    }
  }

  /** 历史记录：用户文本输出为 user_message，助手文本总是输出 */
  mapHistory(msg: unknown): AgentEvent[] {
    if (!isRec(msg) || msg.parent_tool_use_id || msg.parent_agent_id) return [];
    if (msg.type === 'system') return claudeCompactionBoundary(msg);
    if (msg.type === 'assistant') {
      const forkPoint = claudeHistoryForkPoint(msg, this.historySessionId);
      const events = [...this.assistant(msg, true), ...claudeHistoryUsage(msg.message)];
      if (forkPoint) events.push({ type: 'turn_end', isError: !!msg.error, forkPoint });
      return events;
    }
    if (msg.type !== 'user') return [];
    return [...userTexts(msg), ...this.toolResults(msg, false)];
  }

  /** SDK 将同一 API 回复拆成多条内容块；统计只放在最后一块之后，保持正文连续。 */
  mapHistoryBatch(messages: unknown[]): AgentEvent[] {
    const blocks = messages.map((message) => ({ id: historyMessageId(message), events: this.mapHistory(message) }));
    const statistics = historyUsagePositions(blocks);
    return blocks.flatMap((block, position) => withHistoryUsage(block, position, statistics));
  }

  private end(msg: Rec): AgentEvent[] {
    // result.uuid 不在 transcript 链中；只取同一会话最后一条助手原生消息的 UUID。
    const forkPoint = this.lastAssistant?.sessionId === msg.session_id ? this.lastAssistant?.pointId : undefined;
    this.lastAssistant = undefined;
    return turnEndEvent(msg, forkPoint);
  }

  private streamEvent(event: unknown): AgentEvent[] {
    if (!isRec(event)) return [];
    if (event.type === 'message_start' && isRec(event.message)) {
      this.currentMessageId = str(event.message.id);
      this.lastAssistant = undefined;
      return [];
    }
    if (event.type !== 'content_block_delta' || !isRec(event.delta)) return [];
    const e = deltaEvent(event.delta);
    if (!e) return [];
    this.markStreamed(e.type);
    return [e];
  }

  private markStreamed(type: AgentEvent['type']): void {
    if (type === 'text') {
      this.anyDelta = true;
      if (this.currentMessageId) this.streamed.add(this.currentMessageId);
    } else {
      this.anyThinkingDelta = true;
      if (this.currentMessageId) this.streamedThinking.add(this.currentMessageId);
    }
  }

  private assistant(msg: Rec, history: boolean): AgentEvent[] {
    const inner = isRec(msg.message) ? msg.message : {};
    const id = str(inner.id);
    // 没有流式输出过的消息才输出全文，避免重复
    const includeText = history || !(id ? this.streamed.has(id) : this.anyDelta);
    const includeThinking = history || !(id ? this.streamedThinking.has(id) : this.anyThinkingDelta);
    const events = blocksOf(msg).flatMap((b) => assistantBlock(b, includeText, includeThinking));
    return history ? events : events.flatMap((event) => this.tools.observe(event));
  }

  private toolResults(msg: Rec, live = true): AgentEvent[] {
    const events = blocksOf(msg).flatMap((b): AgentEvent[] =>
      isRec(b) && b.type === 'tool_result'
        ? [
            {
              type: 'tool_result',
              id: str(b.tool_use_id) ?? '',
              output: truncate(toolResultText(b.content)),
              isError: b.is_error === true,
            },
          ]
        : [],
    );
    return live ? events.flatMap((event) => this.tools.observe(event)) : events;
  }
}
