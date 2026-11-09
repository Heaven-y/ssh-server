import { getSubagentMessages, listSubagents } from '@anthropic-ai/claude-agent-sdk';
import {
  SubagentIdSchema,
  type AgentEvent,
  type SubagentQuery,
  type SubagentRead,
} from '@agentdeck/shared/conversation';
import { SessionError } from '../errors';
import { ClaudeEventMapper } from './mapper';

export type ClaudeSubagentApi = {
  list(id: string, dir: string): Promise<string[]>;
  messages(id: string, agentId: string, dir: string, page: { limit: number; offset: number }): Promise<unknown[]>;
};
const nativeApi: ClaudeSubagentApi = {
  list: (id, dir) => listSubagents(id, { dir }),
  messages: (id, agentId, dir, page) => getSubagentMessages(id, agentId, { dir, ...page }),
};
const PAGE_SIZE = 100;
const MAX_REPLY_MESSAGES = 1000;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

function replyId(message: unknown): string | undefined {
  const wrapper = record(message);
  const inner = record(wrapper.message);
  return wrapper.type === 'assistant' && typeof inner.id === 'string' && inner.id ? inner.id : undefined;
}

/** 页尾同一 API 回复的内容块必须同行交付，否则统计和正文会在前端被分开。 */
function pageEnd(messages: unknown[]): number {
  let end = Math.min(PAGE_SIZE, messages.length);
  const nextId = replyId(messages[end]);
  if (nextId) while (end > 0 && replyId(messages[end - 1]) === nextId) end--;
  return end;
}

type PageInput = { id: string; agentId: string; dir: string; offset: number; signal?: AbortSignal };
async function completePage(api: ClaudeSubagentApi, input: PageInput) {
  const read = (limit: number) => api.messages(input.id, input.agentId, input.dir, { offset: input.offset, limit });
  let messages = await read(PAGE_SIZE + 1);
  input.signal?.throwIfAborted();
  let end = pageEnd(messages);
  if (!end && messages.length) {
    messages = await read(MAX_REPLY_MESSAGES + 1);
    input.signal?.throwIfAborted();
    const firstId = replyId(messages[0]);
    const boundary = messages.findIndex((message) => replyId(message) !== firstId);
    end = boundary < 0 ? messages.length : boundary;
    if (end > MAX_REPLY_MESSAGES)
      throw new SessionError(503, 'session_runtime_failed', '单条子代理回复过长，暂时无法读取完整历史。');
  }
  return {
    messages: messages.slice(0, end),
    ...(messages.length > end ? { nextCursor: String(input.offset + end) } : {}),
  };
}

function childEvents(messages: unknown[]): AgentEvent[] {
  // SDK 已按子代理文件读取；解除父引用过滤只限此独立视图，不能改变主会话映射。
  const normalized = messages.map((message) => ({
    ...record(message),
    parent_tool_use_id: null,
    parent_agent_id: null,
  }));
  return new ClaudeEventMapper()
    .mapHistoryBatch(normalized)
    .map((event) => (event.type === 'turn_end' ? { type: 'turn_end', isError: event.isError } : event));
}

export function createClaudeSubagents(api: ClaudeSubagentApi = nativeApi) {
  return async (id: string, dir: string, query: SubagentQuery, signal?: AbortSignal): Promise<SubagentRead> => {
    signal?.throwIfAborted();
    const agentIds = [...new Set(await api.list(id, dir))].filter((value) => SubagentIdSchema.safeParse(value).success);
    signal?.throwIfAborted();
    if (!query.agentId) return { agentIds };
    if (!agentIds.includes(query.agentId)) throw new SessionError(404, 'session_missing', '此子代理记录不存在');
    const offset = Number(query.cursor ?? 0);
    const { messages: page, nextCursor } = await completePage(api, { id, agentId: query.agentId, dir, offset, signal });
    const parent = page
      .map((message) => record(message).parent_agent_id)
      .find((value) => SubagentIdSchema.safeParse(value).success);
    return {
      agentId: query.agentId,
      events: childEvents(page),
      ...(typeof parent === 'string' ? { parentAgentId: parent } : {}),
      ...(nextCursor ? { nextCursor } : {}),
    };
  };
}
