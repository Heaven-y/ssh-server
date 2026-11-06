import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@agentdeck/shared/conversation';
import { reduceChat, resolvePermission, type ChatItem } from '../../../src/features/chat/chat-reducer';

const run = (events: AgentEvent[], start: ChatItem[] = []) => events.reduce(reduceChat, start);

describe('reduceChat', () => {
  it('压缩只接受原生终态，普通轮次成功不改写失败、中断或未确认边界', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      const items = run([
        { type: 'compaction', state: { status: 'running', trigger: 'manual' } },
        { type: 'compaction', state: { status, trigger: 'manual', message: '原生结果' } },
        { type: 'turn_end', isError: false },
      ]);
      expect(items).toMatchObject([{ kind: 'compaction', state: { status, message: '原生结果' } }]);
      expect(items[0]).not.toHaveProperty('incomplete');
    }
    const history = run([
      { type: 'compaction', state: { status: 'completed', trigger: 'auto' } },
      { type: 'turn_end', isError: false },
      { type: 'compaction', state: { status: 'running', trigger: 'manual' } },
      { type: 'turn_end', isError: false },
    ]);
    expect(history).toMatchObject([
      { kind: 'compaction', state: { status: 'completed', trigger: 'auto' } },
      { kind: 'compaction', state: { status: 'running', trigger: 'manual' }, incomplete: true },
    ]);
  });

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
      { type: 'tool_call', id: 't1', name: 'mcp__my-server__remote_exec', input: { command: 'ls' } },
      { type: 'tool_result', id: 't1', output: 'ok', isError: true },
      { type: 'turn_end', isError: true },
      { type: 'turn_end', isError: false },
    ]);
    expect(items).toEqual([
      {
        kind: 'tool',
        id: expect.any(String),
        nativeId: 't1',
        name: 'mcp__my-server__remote_exec',
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

it('只保留服务端给出的原生分叉点，重复结束不复制，普通结束不虚构标识', () => {
  const source = run([
    { type: 'text', delta: '第一轮' },
    { type: 'turn_end', isError: false, forkPoint: 'native-turn-1' },
    { type: 'turn_end', isError: false, forkPoint: 'native-turn-1' },
    { type: 'text', delta: '第二轮' },
    { type: 'turn_end', isError: false },
  ]);
  expect(source.filter((item) => item.kind === 'fork-point')).toEqual([
    { kind: 'fork-point', id: expect.any(String), pointId: 'native-turn-1' },
  ]);
  expect(source.map((item) => item.kind)).toEqual(['assistant', 'fork-point', 'assistant']);
  expect(source.at(-1)).toMatchObject({ streaming: false });
  expect(run([{ type: 'turn_end', isError: true }])).toEqual([]);
});

it('回合统计在重复结束和补结束后保持唯一，下一轮另记且不复制累计费用', () => {
  const ended: AgentEvent = {
    type: 'turn_end',
    isError: false,
    durationMs: 2000,
    costUsd: 9,
    usage: { source: 'claude', scope: 'turn', inputTokens: 400, outputTokens: 100 },
    forkPoint: 'turn-one',
  };
  const source = run([
    { type: 'user_message', text: '第一轮' },
    { type: 'text', delta: '回答' },
    ended,
    ended,
    { type: 'turn_end', isError: false },
    { type: 'user_message', text: '第二轮' },
    { type: 'text', delta: '下一轮' },
    { type: 'turn_end', isError: false, durationMs: 1000 },
  ]);
  const statistics = source.filter((item) => item.kind === 'statistics');
  expect(statistics).toHaveLength(2);
  expect(statistics[0]).toMatchObject({ scope: 'turn', durationMs: 2000, usage: { outputTokens: 100 } });
  expect(statistics[0]).not.toHaveProperty('costUsd');
  expect(statistics[1]).not.toHaveProperty('usage');
});

it('工具进度及步骤用量按身份更新，已结束工具不被迟到进度改写', () => {
  const usage = { source: 'antigravity' as const, scope: 'step' as const, outputTokens: 20 };
  const source = run([
    { type: 'tool_call', id: 'command', name: 'run_command', input: { command: 'demo' } },
    { type: 'tool_progress', id: 'command', durationMs: 100, message: '读取中' },
    { type: 'tool_call', id: 'command', name: 'run_command', input: { command: 'demo' } },
    {
      type: 'tool_result',
      id: 'command',
      output: 'done',
      isError: false,
      durationMs: 300,
      timingSource: 'native',
      usage,
    },
    { type: 'tool_progress', id: 'command', durationMs: 900, message: '迟到消息' },
    { type: 'step_usage', id: 'model', usage, durationMs: 1000 },
    { type: 'step_usage', id: 'model', usage: { ...usage, outputTokens: 25 }, durationMs: 1200 },
  ]);
  expect(source).toHaveLength(2);
  expect(source[0]).toMatchObject({ kind: 'tool', status: 'done', durationMs: 300, usage });
  expect(source[0]).not.toHaveProperty('progress', '迟到消息');
  expect(source[1]).toMatchObject({ kind: 'statistics', scope: 'step', usage: { outputTokens: 25 }, durationMs: 1200 });
});

it('未知原生活动独立记录状态，回合结束不把未完成活动标成成功', () => {
  const source = run([
    { type: 'activity', id: 'native-step', name: '原生活动', status: 'running', input: { kind: 'native' } },
    { type: 'activity', id: 'native-step', name: '原生活动', status: 'running', durationMs: 500 },
    { type: 'turn_end', isError: false },
  ]);
  expect(source).toEqual([
    {
      kind: 'activity',
      id: expect.any(String),
      nativeId: 'native-step',
      name: '原生活动',
      status: 'running',
      input: { kind: 'native' },
      durationMs: 500,
      incomplete: true,
    },
  ]);
  expect(run([{ type: 'activity', id: 'native-step', name: '原生活动', status: 'unknown' }])[0]).toMatchObject({
    status: 'unknown',
  });
});

it('原生 ID 跨轮复用不改写旧工具、活动或统计，界面 key 保持唯一', () => {
  const usage = { source: 'antigravity' as const, scope: 'step' as const, outputTokens: 10 };
  const first = run([
    { type: 'user_message', text: '第一轮' },
    { type: 'tool_call', id: 'same', name: 'command', input: {} },
    { type: 'tool_result', id: 'same', output: '第一轮结果', isError: false },
    { type: 'activity', id: 'same', name: '原生活动', status: 'completed' },
    { type: 'step_usage', id: 'same', usage, durationMs: 1000 },
    { type: 'turn_end', isError: false },
  ]);
  const snapshot = JSON.stringify(first);
  const source = run(
    [
      { type: 'user_message', text: '第二轮' },
      { type: 'tool_call', id: 'same', name: 'command', input: {} },
      { type: 'tool_result', id: 'same', output: '第二轮结果', isError: true },
      { type: 'activity', id: 'same', name: '新活动', status: 'failed' },
      { type: 'step_usage', id: 'same', usage: { ...usage, outputTokens: 30 }, durationMs: 2000 },
    ],
    first,
  );
  expect(JSON.stringify(source.slice(0, first.length))).toBe(snapshot);
  expect(new Set(source.map((item) => item.id)).size).toBe(source.length);
  expect(source.filter((item) => item.kind === 'tool').map((item) => item.output)).toEqual([
    '第一轮结果',
    '第二轮结果',
  ]);
  expect(source.at(-1)).toMatchObject({ kind: 'statistics', usage: { outputTokens: 30 } });
});

it('无用量的失败补结束仍会标记当前统计失败，后续成功补结束不改回成功', () => {
  const source = run([
    { type: 'user_message', text: '本轮' },
    {
      type: 'turn_end',
      isError: false,
      durationMs: 1000,
      usage: { source: 'claude', scope: 'turn', outputTokens: 10 },
    },
    { type: 'error', message: '进程退出失败' },
    { type: 'turn_end', isError: true },
    { type: 'turn_end', isError: false },
  ]);
  expect(source.filter((item) => item.kind === 'statistics')).toMatchObject([{ isError: true, durationMs: 1000 }]);
});
