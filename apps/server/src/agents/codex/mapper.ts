import { NativeSessionIdSchema, type AgentEvent, type TokenUsage } from '@agentdeck/shared';
import { CodexCompaction } from './compaction';
import { list, record, text, type RecordValue } from './types';
import { codexItemDuration, CodexTurnUsage, nonnegativeInteger, type CodexUsageBreakdown } from './observability';
import { codexToolCompleted, codexToolFailed, codexToolInput, codexToolOutput, isCodexTool } from './tool-items';

const DELTAS = new Map([
  ['item/agentMessage/delta', 'text'],
  ['item/reasoning/summaryTextDelta', 'reasoning'],
  ['item/reasoning/textDelta', 'reasoning'],
] as const);

/** 原生明确终止的轮次才可以作为 inclusive 分叉位置。 */
export function codexForkPoint(turn: RecordValue): string | undefined {
  if (!['completed', 'failed', 'interrupted'].includes(text(turn.status))) return;
  const id = NativeSessionIdSchema.safeParse(turn.id);
  return id.success ? id.data : undefined;
}

export function turnEnd(turn: RecordValue, usage?: TokenUsage): Extract<AgentEvent, { type: 'turn_end' }> {
  const forkPoint = codexForkPoint(turn);
  const durationMs = nonnegativeInteger(turn.durationMs);
  return {
    type: 'turn_end',
    isError: turn.status === 'failed' || turn.status === 'interrupted',
    ...(durationMs !== undefined ? { durationMs, timingSource: 'native' as const } : {}),
    ...(usage ? { usage } : {}),
    ...(forkPoint ? { forkPoint } : {}),
  };
}

/** 一轮一个实例，以原生 item.id 去重流式与最终快照。 */
export class CodexEventMapper {
  private readonly streamed = new Set<string>();
  private readonly completed = new Set<string>();
  private readonly called = new Set<string>();
  private readonly items = new Map<string, RecordValue>();
  private readonly compaction: CodexCompaction;
  private usedTokens?: number;
  private model?: string;
  private readonly usage = new CodexTurnUsage();

  constructor(options: { manualCompaction?: boolean } = {}) {
    this.compaction = new CodexCompaction(options.manualCompaction === true);
  }

  setModel(model: string): void {
    this.model = model || undefined;
  }
  startManualCompaction(): AgentEvent[] {
    return this.compaction.startManual(this.usedTokens);
  }
  finishCompaction(status: string): AgentEvent[] {
    return this.compaction.finish(status);
  }
  compactionConfirmed(): boolean {
    return this.compaction.confirmed;
  }

  beginUsage(baseline?: CodexUsageBreakdown): void {
    this.usage.begin(baseline);
  }

  cumulativeUsage(): CodexUsageBreakdown | undefined {
    return this.usage.snapshot();
  }

  turnUsage(): TokenUsage | undefined {
    return this.usage.result();
  }

  invalidateUsage(): void {
    this.usage.invalidate();
  }

  item(id: string): RecordValue {
    return this.items.get(id) ?? {};
  }

  map(method: string, params: RecordValue): AgentEvent[] {
    if (method === 'thread/tokenUsage/updated') return [this.context(params)];
    if (method === 'item/mcpToolCall/progress') {
      const id = text(params.itemId);
      const message = text(params.message);
      return id && message ? [{ type: 'tool_progress', id, message }] : [];
    }
    if (method === 'item/started' || method === 'item/completed') {
      return this.mapItem(record(params.item), method === 'item/completed', false);
    }
    const type = DELTAS.get(method as Parameters<typeof DELTAS.get>[0]);
    if (!type || !text(params.delta)) return [];
    this.streamed.add(`${type}:${text(params.itemId)}`);
    return [{ type, delta: text(params.delta) }];
  }

  history(turn: RecordValue): AgentEvent[] {
    return [
      ...list(turn.items).flatMap((item) => this.mapItem(record(item), true, true, turn.status === 'completed')),
      turnEnd(turn),
    ];
  }

  finishItems(turn: RecordValue): AgentEvent[] {
    // 完成通知的快照不是压缩完成确认；手动压缩必须收到当前 item/completed。
    return list(turn.items)
      .filter((item) => record(item).type !== 'contextCompaction')
      .flatMap((item) => this.mapItem(record(item), true, false, turn.status === 'completed'));
  }

  private context(params: RecordValue): AgentEvent {
    const usage = record(params.tokenUsage);
    this.usage.observe(usage.total);
    const used = nonnegativeInteger(record(usage.last).totalTokens);
    if (used === undefined) {
      this.usedTokens = undefined;
      return { type: 'context', usage: null };
    }
    this.usedTokens = used;
    const window = usage.modelContextWindow;
    return {
      type: 'context',
      usage: {
        usedTokens: used,
        source: 'codex_native',
        ...(typeof window === 'number' && Number.isFinite(window) && window > 0 ? { windowTokens: window } : {}),
        ...(this.model ? { model: this.model } : {}),
      },
    };
  }

  private mapItem(item: RecordValue, complete: boolean, history: boolean, completionConfirmed = true): AgentEvent[] {
    const id = text(item.id);
    if (!id) return [];
    const previous = this.items.get(id);
    item = { ...item, startedAtMs: item.startedAtMs ?? previous?.startedAtMs };
    this.items.set(id, item);
    if (item.type === 'contextCompaction') return this.mapCompaction(item, complete, history);
    if (isCodexTool(item)) return this.mapTool(item, complete && codexToolCompleted(item, completionConfirmed));
    if (!complete || this.completed.has(id)) return [];
    this.completed.add(id);
    return this.mapText(item, history);
  }

  private mapCompaction(item: RecordValue, complete: boolean, history: boolean): AgentEvent[] {
    if (!history) {
      if (!complete && !this.called.has(text(item.id))) {
        this.called.add(text(item.id));
        this.usage.requireFreshSnapshot();
      }
      return this.compaction.item(text(item.id), complete, this.usedTokens);
    }
    if (this.completed.has(text(item.id))) return [];
    this.completed.add(text(item.id));
    const trigger = item.trigger === 'manual' || item.trigger === 'auto' ? item.trigger : undefined;
    return [{ type: 'compaction', state: { status: 'completed', ...(trigger ? { trigger } : {}) } }];
  }

  private mapText(item: RecordValue, history: boolean): AgentEvent[] {
    const id = text(item.id);
    if (item.type === 'userMessage') return history ? this.userMessage(item) : [];
    if (item.type === 'agentMessage' && !this.streamed.has(`text:${id}`)) {
      return [{ type: 'text', delta: text(item.text) }];
    }
    if (item.type !== 'reasoning' || this.streamed.has(`reasoning:${id}`)) return [];
    const summary = list(item.summary).map(text).join('\n');
    const content = summary || list(item.content).map(text).join('\n');
    return content ? [{ type: 'reasoning', delta: content }] : [];
  }

  private userMessage(item: RecordValue): AgentEvent[] {
    const content = list(item.content)
      .map((part) => {
        const value = record(part);
        if (value.type === 'text') return text(value.text);
        return value.type === 'skill' && text(value.name) ? `技能：${text(value.name)}` : '';
      })
      .filter(Boolean)
      .join('\n');
    return content ? [{ type: 'user_message', text: content }] : [];
  }

  private mapTool(item: RecordValue, complete: boolean): AgentEvent[] {
    const id = text(item.id);
    const events: AgentEvent[] = [];
    if (!this.called.has(id)) {
      this.called.add(id);
      events.push({ type: 'tool_call', id, ...codexToolInput(item) });
    }
    if (complete && !this.completed.has(id)) {
      this.completed.add(id);
      events.push({
        type: 'tool_result',
        id,
        output: codexToolOutput(item),
        isError: codexToolFailed(item),
        ...codexItemDuration(item),
      });
    }
    return events;
  }
}
