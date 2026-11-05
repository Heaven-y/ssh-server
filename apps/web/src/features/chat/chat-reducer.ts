// 把 Agent 事件转成界面条目：实时对话和历史记录共用，纯函数，不修改入参
import { NativeSessionIdSchema, type AgentEvent, type CompactionState } from '@agentdeck/shared';

export type ChatItem =
  | { kind: 'fork-point'; id: string; pointId: string }
  | { kind: 'compaction'; id: string; state: CompactionState; incomplete?: boolean }
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'reasoning'; id: string; text: string }
  | {
      kind: 'tool';
      id: string;
      name: string;
      input: unknown;
      output?: string;
      isError?: boolean;
      status: 'running' | 'done' | 'incomplete';
    }
  | {
      kind: 'permission';
      id: string;
      toolName: string;
      input: unknown;
      description?: string;
      resolved?: 'allow' | 'deny' | 'cancelled';
      responding?: boolean;
    }
  | { kind: 'error'; id: string; message: string };

/** 条目只会追加，用位置生成 id 即可保证唯一且稳定（用作 React key） */
const nextId = (items: ChatItem[], kind: string) => `${kind}-${items.length}`;

/** 最后一个条目是同类时拼接文本，否则追加新条目 */
function appendText(items: ChatItem[], kind: 'assistant' | 'reasoning', delta: string): ChatItem[] {
  const last = items.at(-1);
  if (last?.kind === 'assistant' && kind === 'assistant' && last.streaming) {
    return [...items.slice(0, -1), { ...last, text: last.text + delta }];
  }
  if (last?.kind === 'reasoning' && kind === 'reasoning') {
    return [...items.slice(0, -1), { ...last, text: last.text + delta }];
  }
  const id = nextId(items, kind);
  return [...items, kind === 'assistant' ? { kind, id, text: delta, streaming: true } : { kind, id, text: delta }];
}

/**
 * 历史接口返回的是完整事件序列，不是实时流：`text`/`reasoning` 的 delta 可能已是一整段。
 * 复用实时对话的归并规则（连续 delta 合成一条消息、tool_result 回填工具卡片），
 * 末尾补一个 turn_end 让最后一段内容脱离流式态；只读视图不提供分叉入口，因此丢掉分叉点。
 */
export function historyItems(events: AgentEvent[]): ChatItem[] {
  const closed = [...events, { type: 'turn_end' as const, isError: false }].reduce<ChatItem[]>(reduceChat, []);
  return closed.filter((item) => item.kind !== 'fork-point');
}

export function reduceChat(items: ChatItem[], e: AgentEvent): ChatItem[] {
  switch (e.type) {
    case 'compaction':
      return updateCompaction(items, e.state);
    case 'user_message':
      return [...items, { kind: 'user', id: nextId(items, 'user'), text: e.text }];
    case 'text':
      return appendText(items, 'assistant', e.delta);
    case 'reasoning':
      return appendText(items, 'reasoning', e.delta);
    case 'tool_call':
      return [...items, { kind: 'tool', id: e.id, name: e.name, input: e.input, status: 'running' }];
    case 'tool_result':
      return items.map((i) =>
        i.kind === 'tool' && i.id === e.id ? { ...i, output: e.output, isError: e.isError, status: 'done' } : i,
      );
    default:
      return reduceLifecycle(items, e);
  }
}

function finishItems(items: ChatItem[]): ChatItem[] {
  return items.map((item) => {
    if (item.kind === 'compaction' && item.state.status === 'running') return { ...item, incomplete: true };
    if (item.kind === 'assistant' && item.streaming) return { ...item, streaming: false };
    if (item.kind === 'tool' && item.status === 'running') return { ...item, status: 'incomplete' };
    if (item.kind === 'permission' && !item.resolved) return { ...item, resolved: 'cancelled', responding: false };
    return item;
  });
}

function finishTurn(items: ChatItem[], pointId?: string): ChatItem[] {
  const finished = finishItems(items);
  if (!pointId || !NativeSessionIdSchema.safeParse(pointId).success) return finished;
  if (items.some((item) => item.kind === 'fork-point' && item.pointId === pointId)) return finished;
  return [...finished, { kind: 'fork-point', id: nextId(items, 'fork-point'), pointId }];
}

/** 只由原生压缩事件确认结果；轮次结束不能把未确认的压缩标成成功。 */
function updateCompaction(items: ChatItem[], state: CompactionState): ChatItem[] {
  const index = items.findLastIndex(
    (item) => item.kind === 'compaction' && item.state.status === 'running' && !item.incomplete,
  );
  if (index < 0) return [...items, { kind: 'compaction', id: nextId(items, 'compaction'), state }];
  return items.map((item, position) => (position === index ? { ...item, state } : item));
}

function reduceLifecycle(items: ChatItem[], e: AgentEvent): ChatItem[] {
  switch (e.type) {
    case 'permission_request':
      return [
        ...items,
        { kind: 'permission', id: e.requestId, toolName: e.toolName, input: e.input, description: e.description },
      ];
    case 'turn_end':
      return finishTurn(items, e.forkPoint);
    case 'permission_resolved':
      return resolvePermission(items, e.requestId, e.decision);
    case 'error':
      return [...items, { kind: 'error', id: nextId(items, 'error'), message: e.message }];
    default:
      return items;
  }
}

export function resolvePermission(
  items: ChatItem[],
  requestId: string,
  decision: 'allowed' | 'denied' | 'cancelled',
): ChatItem[] {
  const resolved = { allowed: 'allow', denied: 'deny', cancelled: 'cancelled' } as const;
  return items.map((i) =>
    i.kind === 'permission' && i.id === requestId && !i.resolved
      ? { ...i, resolved: resolved[decision], responding: false }
      : i,
  );
}

export function markPermissionPending(items: ChatItem[], requestId: string): ChatItem[] {
  return items.map((item) =>
    item.kind === 'permission' && item.id === requestId && !item.resolved ? { ...item, responding: true } : item,
  );
}
