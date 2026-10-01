// 把 Claude Agent SDK 的消息转换成统一的 AgentEvent
import type { AgentEvent } from '@ssh-server/shared';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

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

const num = (v: unknown) => (typeof v === 'number' ? v : undefined);

function turnEndEvent(msg: Rec): AgentEvent[] {
  const failedSubtype = typeof msg.subtype === 'string' && msg.subtype !== 'success';
  return [
    {
      type: 'turn_end',
      isError: msg.is_error === true || failedSubtype,
      durationMs: num(msg.duration_ms),
      costUsd: num(msg.total_cost_usd),
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

/** 助手消息中的一个内容块：tool_use 总是输出，text 按 includeText 决定 */
function assistantBlock(b: unknown, includeText: boolean): AgentEvent[] {
  if (!isRec(b)) return [];
  if (b.type === 'tool_use')
    return [{ type: 'tool_call', id: str(b.id) ?? '', name: str(b.name) ?? '', input: b.input }];
  const text = b.type === 'text' ? str(b.text) : undefined;
  return text && includeText ? [{ type: 'text', delta: text }] : [];
}
/** 每轮对话新建一个 mapper：它记录哪些消息已经流式输出过文本 */
export class ClaudeEventMapper {
  /** 已经收到过 text_delta 的消息 id */
  private streamed = new Set<string>();
  private currentMessageId: string | undefined;
  /** 没有消息 id 时的退路：本轮是否收到过 text_delta */
  private anyDelta = false;

  map(msg: unknown): AgentEvent[] {
    // 子代理的消息不在 M1 中展示
    if (!isRec(msg) || msg.parent_tool_use_id) return [];
    switch (msg.type) {
      case 'system':
        return sessionEvent(msg);
      case 'stream_event':
        return this.streamEvent(msg.event);
      case 'assistant':
        return this.assistant(msg, false);
      case 'user':
        return this.toolResults(msg);
      case 'result':
        return turnEndEvent(msg);
      default:
        return [];
    }
  }

  /** 历史记录：用户文本输出为 user_message，助手文本总是输出 */
  mapHistory(msg: unknown): AgentEvent[] {
    if (!isRec(msg) || msg.parent_tool_use_id) return [];
    if (msg.type === 'assistant') return this.assistant(msg, true);
    if (msg.type !== 'user') return [];
    return [...userTexts(msg), ...this.toolResults(msg)];
  }

  private streamEvent(event: unknown): AgentEvent[] {
    if (!isRec(event)) return [];
    if (event.type === 'message_start' && isRec(event.message)) {
      this.currentMessageId = str(event.message.id);
      return [];
    }
    if (event.type !== 'content_block_delta' || !isRec(event.delta)) return [];
    const e = deltaEvent(event.delta);
    if (e?.type === 'text') this.markStreamed();
    return e ? [e] : [];
  }

  private markStreamed(): void {
    this.anyDelta = true;
    if (this.currentMessageId) this.streamed.add(this.currentMessageId);
  }

  private assistant(msg: Rec, history: boolean): AgentEvent[] {
    const inner = isRec(msg.message) ? msg.message : {};
    const id = str(inner.id);
    // 没有流式输出过的消息才输出全文，避免重复
    const includeText = history || !(id ? this.streamed.has(id) : this.anyDelta);
    return blocksOf(msg).flatMap((b) => assistantBlock(b, includeText));
  }

  private toolResults(msg: Rec): AgentEvent[] {
    return blocksOf(msg).flatMap((b): AgentEvent[] =>
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
  }
}
