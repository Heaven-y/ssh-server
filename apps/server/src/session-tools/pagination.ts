import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AgentEvent } from '@agentdeck/shared/conversation';
import { SessionReadError } from './errors';

type HistoryItem = {
  type: 'user_message' | 'assistant_message' | 'tool_call' | 'tool_result' | 'activity';
  content: string;
};
export type SessionReadItem = HistoryItem & { index: number; offset: number; complete: boolean };
export type SessionReadPage = { reference: string; items: SessionReadItem[]; nextCursor?: string };
const Cursor = z.strictObject({
  v: z.literal(1),
  r: z.string().regex(/^[a-f0-9]{64}$/),
  s: z.string().regex(/^[a-f0-9]{64}$/),
  i: z.number().int().nonnegative(),
  o: z.number().int().nonnegative(),
});
type Position = { i: number; o: number };
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** 只投影可见对话与工具内容；不展开系统事件、思考、运行诊断或原始内部对象。 */
export function readableHistory(events: AgentEvent[]): HistoryItem[] {
  return events.flatMap((event): HistoryItem[] => {
    switch (event.type) {
      case 'user_message':
        return [{ type: 'user_message', content: event.text }];
      case 'text':
        return [{ type: 'assistant_message', content: event.delta }];
      case 'tool_call':
        return [{ type: 'tool_call', content: JSON.stringify({ id: event.id, name: event.name, input: event.input }) }];
      case 'tool_result':
        return [
          {
            type: 'tool_result',
            content: JSON.stringify({ id: event.id, output: event.output, isError: event.isError }),
          },
        ];
      case 'activity':
        return [
          {
            type: 'activity',
            content: JSON.stringify({
              id: event.id,
              name: event.name,
              status: event.status,
              input: event.input,
              output: event.output,
            }),
          },
        ];
      default:
        return [];
    }
  });
}

function nextFragment(item: HistoryItem, position: Position): SessionReadItem {
  // 用 UTF-16 偏移重组文本，但不在代理对中间切分，避免单页出现损坏字符。
  let end = Math.min(position.o + 1024, item.content.length);
  if (end < item.content.length && /[\uD800-\uDBFF]/.test(item.content.charAt(end - 1))) end--;
  return {
    type: item.type,
    content: item.content.slice(position.o, end),
    index: position.i,
    offset: position.o,
    complete: end === item.content.length,
  };
}

function fragments(items: HistoryItem[], start: Position, reference: string) {
  const position = { ...start };
  const result: SessionReadItem[] = [];
  // AGY 会截断较长的 MCP 结果；页面留在 8 KiB 内，为原生包装保留余量。
  // 游标最大约 400 字节，预留 1024 字节；预算按 JSON 转义后的 UTF-8 字节计算。
  let remaining = 8192 - bytes({ reference, items: [], nextCursor: 'x'.repeat(1024) });
  while (position.i < items.length && result.length < 32) {
    const fragment = nextFragment(items[position.i]!, position);
    const size = bytes(fragment) + 1;
    if (size > remaining) break;
    result.push(fragment);
    remaining -= size;
    if (fragment.complete) {
      position.i++;
      position.o = 0;
    } else position.o += fragment.content.length;
  }
  if (!result.length && position.i < items.length) throw new SessionReadError('read_failed');
  return { items: result, position };
}

function assertPosition(cursor: Position, history: HistoryItem[]) {
  const item = history[cursor.i];
  if (!item || (cursor.o > 0 && cursor.o >= item.content.length)) throw new SessionReadError('invalid_cursor');
}

export function createSessionPagination() {
  // 游标只在当前 MCP 进程有效；不落盘保存历史、密钥或第二份会话数据库。
  const secret = randomBytes(32);
  function decode(cursor: string) {
    try {
      const parts = cursor.split('.');
      if (parts.length !== 2 || !parts.every((part) => /^[\w-]+$/.test(part))) throw new Error();
      const [payload, signature] = parts as [string, string];
      const expected = createHmac('sha256', secret).update(payload).digest();
      const actual = Buffer.from(signature, 'base64url');
      if (
        actual.toString('base64url') !== signature ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Error();
      return Cursor.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    } catch {
      throw new SessionReadError('invalid_cursor');
    }
  }
  return {
    read(input: { reference: string; workspaceDir: string; history: HistoryItem[]; cursor?: string }): SessionReadPage {
      const referenceHash = digest([input.reference, input.workspaceDir]);
      const snapshot = digest(input.history);
      const cursor = input.cursor ? decode(input.cursor) : undefined;
      if (cursor && cursor.r !== referenceHash) throw new SessionReadError('invalid_cursor');
      if (cursor && cursor.s !== snapshot) throw new SessionReadError('stale_cursor');
      const start = cursor ?? { i: 0, o: 0 };
      if (cursor) assertPosition(cursor, input.history);
      const page = fragments(input.history, start, input.reference);
      const result: SessionReadPage = { reference: input.reference, items: page.items };
      if (page.position.i < input.history.length) {
        const payload = Buffer.from(JSON.stringify({ v: 1, r: referenceHash, s: snapshot, ...page.position })).toString(
          'base64url',
        );
        result.nextCursor = `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
      }
      return result;
    },
  };
}
