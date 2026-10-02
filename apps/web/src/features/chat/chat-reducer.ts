// 把 Agent 事件转成界面条目：实时对话和历史记录共用，纯函数，不修改入参
import type { AgentEvent } from '@ssh-server/shared';

export type ChatItem =
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

export function reduceChat(items: ChatItem[], e: AgentEvent): ChatItem[] {
  switch (e.type) {
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
    if (item.kind === 'assistant' && item.streaming) return { ...item, streaming: false };
    if (item.kind === 'tool' && item.status === 'running') return { ...item, status: 'incomplete' };
    if (item.kind === 'permission' && !item.resolved) return { ...item, resolved: 'cancelled', responding: false };
    return item;
  });
}

function reduceLifecycle(items: ChatItem[], e: AgentEvent): ChatItem[] {
  switch (e.type) {
    case 'permission_request':
      return [
        ...items,
        { kind: 'permission', id: e.requestId, toolName: e.toolName, input: e.input, description: e.description },
      ];
    case 'turn_end':
      return finishItems(items);
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
