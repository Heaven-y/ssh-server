import type { AgentEvent } from '@ssh-server/shared';
import { list, record, text, type RecordValue } from './types';

const TOOL_OUTPUT_MAX_CHARS = 20_000;
const TOOL_TYPES = new Set(['commandExecution', 'fileChange', 'mcpToolCall']);
const DELTAS = new Map([
  ['item/agentMessage/delta', 'text'],
  ['item/reasoning/summaryTextDelta', 'reasoning'],
  ['item/reasoning/textDelta', 'reasoning'],
] as const);

function printable(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}
function bounded(value: string): string {
  return value.length <= TOOL_OUTPUT_MAX_CHARS
    ? value
    : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[已截断，共 ${value.length} 字符]`;
}
function fileDiff(item: RecordValue): string {
  return list(item.changes)
    .map((change) => {
      const value = record(change);
      return `${text(value.path)}\n${text(value.diff)}`;
    })
    .join('\n');
}
function toolInput(item: RecordValue): { name: string; input: unknown } {
  switch (item.type) {
    case 'commandExecution':
      return { name: 'commandExecution', input: { command: item.command, cwd: item.cwd } };
    case 'fileChange':
      return { name: 'fileChange', input: { changes: item.changes } };
    default:
      return { name: `mcp__${text(item.server)}__${text(item.tool)}`, input: item.arguments };
  }
}
function toolOutput(item: RecordValue): string {
  if (item.type === 'commandExecution') return text(item.aggregatedOutput);
  if (item.type === 'fileChange') return fileDiff(item);
  return printable(item.error ?? item.result);
}
function failed(item: RecordValue): boolean {
  return (
    item.status === 'failed' ||
    item.status === 'declined' ||
    item.status === 'cancelled' ||
    (typeof item.exitCode === 'number' && item.exitCode !== 0)
  );
}
export function turnEnd(turn: RecordValue): AgentEvent {
  return {
    type: 'turn_end',
    isError: turn.status === 'failed',
    ...(typeof turn.durationMs === 'number' ? { durationMs: turn.durationMs } : {}),
  };
}

/** 一轮一个实例，以原生 item.id 去重流式与最终快照。 */
export class CodexEventMapper {
  private readonly streamed = new Set<string>();
  private readonly completed = new Set<string>();
  private readonly called = new Set<string>();
  private readonly items = new Map<string, RecordValue>();

  item(id: string): RecordValue {
    return this.items.get(id) ?? {};
  }

  map(method: string, params: RecordValue): AgentEvent[] {
    if (method === 'item/started' || method === 'item/completed') {
      return this.mapItem(record(params.item), method === 'item/completed', false);
    }
    const type = DELTAS.get(method as Parameters<typeof DELTAS.get>[0]);
    if (!type || !text(params.delta)) return [];
    this.streamed.add(`${type}:${text(params.itemId)}`);
    return [{ type, delta: text(params.delta) }];
  }

  history(turn: RecordValue): AgentEvent[] {
    return [...list(turn.items).flatMap((item) => this.mapItem(record(item), true, true)), turnEnd(turn)];
  }

  finishItems(turn: RecordValue): AgentEvent[] {
    return list(turn.items).flatMap((item) => this.mapItem(record(item), true, false));
  }

  private mapItem(item: RecordValue, complete: boolean, history: boolean): AgentEvent[] {
    const id = text(item.id);
    if (!id) return [];
    this.items.set(id, item);
    if (TOOL_TYPES.has(text(item.type))) return this.mapTool(item, complete);
    if (!complete || this.completed.has(id)) return [];
    this.completed.add(id);
    return this.mapText(item, history);
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
      .filter((part) => record(part).type === 'text')
      .map((part) => text(record(part).text))
      .join('\n');
    return content ? [{ type: 'user_message', text: content }] : [];
  }

  private mapTool(item: RecordValue, complete: boolean): AgentEvent[] {
    const id = text(item.id);
    const events: AgentEvent[] = [];
    if (!this.called.has(id)) {
      this.called.add(id);
      events.push({ type: 'tool_call', id, ...toolInput(item) });
    }
    if (complete && !this.completed.has(id)) {
      this.completed.add(id);
      events.push({ type: 'tool_result', id, output: bounded(toolOutput(item)), isError: failed(item) });
    }
    return events;
  }
}
