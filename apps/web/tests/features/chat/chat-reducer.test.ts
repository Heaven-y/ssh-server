import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@ssh-server/shared';
import { reduceChat, resolvePermission, type ChatItem } from '../../../src/features/chat/chat-reducer';

const run = (events: AgentEvent[], start: ChatItem[] = []) => events.reduce(reduceChat, start);

describe('reduceChat', () => {
  it('连续的 text 拼接到同一个助手条目', () => {
    const items = run([
      { type: 'text', delta: '你' },
      { type: 'text', delta: '好' },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'assistant', text: '你好', streaming: true });
  });

  it('工具调用之后的文本是新的助手条目', () => {
    const items = run([
      { type: 'text', delta: 'a' },
      { type: 'tool_call', id: 't1', name: 'x', input: {} },
      { type: 'text', delta: 'b' },
    ]);
    expect(items.map((i) => i.kind)).toEqual(['assistant', 'tool', 'assistant']);
  });

  it('tool_result 更新对应的工具条目', () => {
    const items = run([
      { type: 'tool_call', id: 't1', name: 'mcp__ssh-server__remote_exec', input: { command: 'ls' } },
      { type: 'tool_result', id: 't1', output: 'ok', isError: true },
      { type: 'turn_end', isError: true },
      { type: 'turn_end', isError: false },
    ]);
    expect(items).toEqual([
      {
        kind: 'tool',
        id: 't1',
        name: 'mcp__ssh-server__remote_exec',
        input: { command: 'ls' },
        output: 'ok',
        isError: true,
        status: 'done',
      },
    ]);
  });

  it('权限请求生成条目，答复后标记结果', () => {
    const items = run([{ type: 'permission_request', requestId: 'p1', toolName: 'Bash', input: { command: 'ls' } }]);
    expect(items[0]).toMatchObject({ kind: 'permission', id: 'p1', toolName: 'Bash' });
    expect(resolvePermission(items, 'p1', 'allowed')[0]).toMatchObject({ resolved: 'allow' });
    expect(resolvePermission(items, 'p1', 'denied')[0]).toMatchObject({ resolved: 'deny' });
    expect(run([{ type: 'permission_resolved', requestId: 'p1', decision: 'cancelled' }], items)[0]).toMatchObject({
      resolved: 'cancelled',
    });
  });

  it('turn_end 结束所有流式条目；error、user_message 生成对应条目', () => {
    const items = run([
      { type: 'user_message', text: '问' },
      { type: 'text', delta: '答' },
      { type: 'error', message: '出错了' },
      { type: 'permission_request', requestId: 'p1', toolName: 'command', input: {} },
      { type: 'tool_call', id: 'unfinished', name: 'command', input: {} },
      { type: 'turn_end', isError: true },
    ]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'error', 'permission', 'tool']);
    expect(items[1]).toMatchObject({ streaming: false });
    expect(items[2]).toMatchObject({ message: '出错了' });
    expect(items[3]).toMatchObject({ resolved: 'cancelled' });
    expect(items[4]).toMatchObject({ status: 'incomplete' });
    expect(items[4]).not.toHaveProperty('isError');
  });

  it('思考增量合并为一个思考条目', () => {
    const items = run([
      { type: 'reasoning', delta: '想' },
      { type: 'reasoning', delta: '一想' },
    ]);
    expect(items).toEqual([{ kind: 'reasoning', id: expect.any(String), text: '想一想' }]);
  });

  it('不修改传入的数组', () => {
    const start: ChatItem[] = [
      { kind: 'assistant', id: 'a', text: 'x', streaming: true },
      { kind: 'tool', id: 'partial', name: 'command', input: {}, output: '已收到部分输出', status: 'running' },
    ];
    const snapshot = JSON.stringify(start);
    reduceChat(start, { type: 'text', delta: 'y' });
    const ended = reduceChat(start, { type: 'turn_end', isError: false });
    expect(ended[1]).toMatchObject({ output: '已收到部分输出', status: 'incomplete' });
    expect(reduceChat(ended, { type: 'turn_end', isError: false })).toEqual(ended);
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});
