import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeEventMapper } from '../../src/agents/claude-mapper';

const stream = (event: unknown) => ({ type: 'stream_event', event, parent_tool_use_id: null, session_id: 's1' });
const delta = (d: unknown) => stream({ type: 'content_block_delta', index: 0, delta: d });
const assistant = (id: string, content: unknown[], parent: string | null = null) => ({
  type: 'assistant',
  message: { id, role: 'assistant', content },
  parent_tool_use_id: parent,
  session_id: 's1',
});
const user = (content: unknown) => ({
  type: 'user',
  message: { role: 'user', content },
  parent_tool_use_id: null,
  session_id: 's1',
});

describe('ClaudeEventMapper.map', () => {
  it('自动压缩按原生保留 UUID 忽略重放，保留压缩后的新回复', () => {
    const m = new ClaudeEventMapper();
    const boundary = {
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: {
        trigger: 'auto',
        pre_tokens: 190000,
        post_tokens: 600,
        preserved_messages: { anchor_uuid: 'summary', uuids: ['old-reply', 'old-result'] },
      },
    };
    expect(m.map(boundary)).toMatchObject([{ type: 'compaction', state: { status: 'completed', trigger: 'auto' } }]);
    expect(m.map({ ...assistant('old-model-id', [{ type: 'text', text: '旧失败回复' }]), uuid: 'old-reply' })).toEqual(
      [],
    );
    expect(
      m.map({ ...user([{ type: 'tool_result', tool_use_id: 'old-tool', content: '旧结果' }]), uuid: 'old-result' }),
    ).toEqual([]);
    expect(
      m.map({ ...assistant('new-model-id', [{ type: 'text', text: '真正的新回复' }]), uuid: 'new-reply' }),
    ).toEqual([{ type: 'text', delta: '真正的新回复' }]);
  });
  it('init → session', () => {
    const m = new ClaudeEventMapper();
    const cwd = path.join(os.tmpdir(), 'ssh-server-fixture', 'demo');
    expect(
      m.map({
        type: 'system',
        subtype: 'init',
        session_id: 's1',
        model: 'claude-x',
        cwd,
        parent_tool_use_id: null,
      }),
    ).toEqual([{ type: 'session', sessionId: 's1', model: 'claude-x', cwd }]);
  });

  it('text_delta → text，thinking_delta → reasoning', () => {
    const m = new ClaudeEventMapper();
    expect(m.map(delta({ type: 'text_delta', text: '你' }))).toEqual([{ type: 'text', delta: '你' }]);
    expect(m.map(delta({ type: 'thinking_delta', thinking: '想' }))).toEqual([{ type: 'reasoning', delta: '想' }]);
  });

  it('assistant 中的 tool_use → tool_call', () => {
    const m = new ClaudeEventMapper();
    const evs = m.map(
      assistant('m1', [{ type: 'tool_use', id: 't1', name: 'mcp__ssh-server__remote_exec', input: { command: 'ls' } }]),
    );
    expect(evs).toEqual([
      { type: 'tool_call', id: 't1', name: 'mcp__ssh-server__remote_exec', input: { command: 'ls' } },
    ]);
  });

  it('该消息没有收到 text_delta 时，输出 assistant 中的全文', () => {
    const m = new ClaudeEventMapper();
    expect(m.map(assistant('m1', [{ type: 'text', text: '全文' }]))).toEqual([{ type: 'text', delta: '全文' }]);
  });

  it('已经流式输出过的消息，不再重复输出全文', () => {
    const m = new ClaudeEventMapper();
    m.map(stream({ type: 'message_start', message: { id: 'm1' } }));
    m.map(delta({ type: 'text_delta', text: '全' }));
    m.map(delta({ type: 'text_delta', text: '文' }));
    expect(m.map(assistant('m1', [{ type: 'text', text: '全文' }]))).toEqual([]);
  });

  it('user 中的 tool_result → tool_result，保留 is_error', () => {
    const m = new ClaudeEventMapper();
    const evs = m.map(
      user([
        { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '退出码：0' }], is_error: true },
      ]),
    );
    expect(evs).toEqual([{ type: 'tool_result', id: 't1', output: '退出码：0', isError: true }]);
  });

  it('tool_result 内容为字符串，过长时截断', () => {
    const m = new ClaudeEventMapper();
    const [ev] = m.map(user([{ type: 'tool_result', tool_use_id: 't2', content: 'x'.repeat(30_000) }]));
    expect(ev).toMatchObject({ type: 'tool_result', id: 't2', isError: false });
    expect((ev as { output: string }).output.length).toBeLessThan(20_100);
  });

  it('result → turn_end', () => {
    const m = new ClaudeEventMapper();
    expect(
      m.map({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1200, total_cost_usd: 0.02 }),
    ).toEqual([{ type: 'turn_end', isError: false, durationMs: 1200, costUsd: 0.02 }]);
    expect(
      m.map({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        duration_ms: 5,
        total_cost_usd: 0,
      })[0],
    ).toMatchObject({
      isError: true,
    });
  });

  it('忽略子代理的消息和未知消息', () => {
    const m = new ClaudeEventMapper();
    expect(m.map(assistant('m2', [{ type: 'text', text: '子代理' }], 'parent-tool'))).toEqual([]);
    expect(m.map({ type: 'system', subtype: 'status' })).toEqual([]);
  });
});

describe('ClaudeEventMapper.mapHistory', () => {
  it('历史仅保留原生压缩边界，不据历史回复补造上下文估计', () => {
    const m = new ClaudeEventMapper();
    expect(
      m.mapHistory({
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: { trigger: 'auto', pre_tokens: 190000, post_tokens: 600 },
      }),
    ).toEqual([
      { type: 'compaction', state: { status: 'completed', trigger: 'auto', beforeTokens: 190000, afterTokens: 600 } },
    ]);
    expect(
      m.mapHistory({
        ...assistant('history', [{ type: 'text', text: '历史回复' }]),
        context_usage: { total_tokens: 500 },
      }),
    ).toEqual([{ type: 'text', delta: '历史回复' }]);
  });
  it('用户文本 → user_message（字符串或 text 块）', () => {
    const m = new ClaudeEventMapper();
    expect(
      m.mapHistory({ type: 'user', message: { role: 'user', content: '帮我看看' }, parent_tool_use_id: null }),
    ).toEqual([{ type: 'user_message', text: '帮我看看' }]);
    expect(
      m.mapHistory({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: '第二句' }] },
        parent_tool_use_id: null,
      }),
    ).toEqual([{ type: 'user_message', text: '第二句' }]);
  });

  it('只有 tool_result 的用户消息不产生 user_message', () => {
    const m = new ClaudeEventMapper();
    const evs = m.mapHistory({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      parent_tool_use_id: null,
    });
    expect(evs).toEqual([{ type: 'tool_result', id: 't1', output: 'ok', isError: false }]);
  });

  it('助手文本总是输出', () => {
    const m = new ClaudeEventMapper();
    expect(
      m.mapHistory({
        type: 'assistant',
        message: { id: 'm1', content: [{ type: 'text', text: '答' }] },
        parent_tool_use_id: null,
      }),
    ).toEqual([{ type: 'text', delta: '答' }]);
  });
});

describe('Claude 原生分叉点', () => {
  const nativeMessage = (uuid: string, stopReason: string | null = 'end_turn') => ({
    ...assistant('api-message-id', [{ type: 'text', text: '完整回复' }]),
    uuid,
    message: {
      id: 'api-message-id',
      role: 'assistant',
      content: [{ type: 'text', text: '完整回复' }],
      stop_reason: stopReason,
    },
  });

  it('历史已结束回复使用 transcript UUID，不使用模型 API message.id', () => {
    expect(new ClaudeEventMapper().mapHistory(nativeMessage('transcript-message-id'))).toEqual([
      { type: 'text', delta: '完整回复' },
      { type: 'turn_end', isError: false, forkPoint: 'transcript-message-id' },
    ]);
  });

  it.each([null, 'tool_use', 'pause_turn'])('历史未结束的 %s 消息不能作为分叉点', (stopReason) => {
    expect(new ClaudeEventMapper().mapHistory(nativeMessage('not-finished', stopReason))).toEqual([
      { type: 'text', delta: '完整回复' },
    ]);
  });

  it('实时 result 只携带同一原生会话最后助手的 transcript UUID', () => {
    const mapper = new ClaudeEventMapper();
    mapper.map(nativeMessage('transcript-message-id', null));
    expect(
      mapper.map({ type: 'result', subtype: 'success', session_id: 's1', uuid: 'result-not-in-transcript' }),
    ).toEqual([{ type: 'turn_end', isError: false, forkPoint: 'transcript-message-id' }]);
    expect(
      mapper.map({ type: 'result', subtype: 'success', session_id: 's1', uuid: 'another-result' })[0],
    ).not.toHaveProperty('forkPoint');
  });

  it.each([
    { label: '不同会话', message: nativeMessage('transcript-message-id'), session: 'foreign' },
    { label: '非法 UUID', message: nativeMessage('../path'), session: 's1' },
    { label: '内部子代理', message: { ...nativeMessage('child'), parent_tool_use_id: 'tool' }, session: 's1' },
    { label: '嵌套子代理', message: { ...nativeMessage('child'), parent_agent_id: 'parent' }, session: 's1' },
  ])('$label 不能把 result 或伪造 ID 作为实时分叉点', ({ message, session }) => {
    const mapper = new ClaudeEventMapper();
    mapper.map(message);
    expect(
      mapper.map({ type: 'result', subtype: 'success', session_id: session, uuid: 'result-not-in-transcript' })[0],
    ).not.toHaveProperty('forkPoint');
  });

  it('后续助手缺原生 UUID 时不沿用前一条，也不从 result UUID 补造', () => {
    const mapper = new ClaudeEventMapper();
    mapper.map(nativeMessage('earlier-message'));
    mapper.map(assistant('later-api-message', [{ type: 'text', text: '后续回复' }]));
    expect(
      mapper.map({ type: 'result', subtype: 'success', session_id: 's1', uuid: 'result-only' })[0],
    ).not.toHaveProperty('forkPoint');
  });
});

it('Claude 新消息已开始但未形成 transcript 消息时不沿用上一条分叉点', () => {
  const mapper = new ClaudeEventMapper();
  mapper.map({ ...assistant('old-message', [{ type: 'text', text: '旧回复' }]), uuid: 'old-transcript' });
  mapper.map(stream({ type: 'message_start', message: { id: 'next-message' } }));
  mapper.map(delta({ type: 'text_delta', text: '未完成的新回复' }));
  expect(mapper.map({ type: 'result', subtype: 'error_during_execution', session_id: 's1' })[0]).not.toHaveProperty(
    'forkPoint',
  );
});

it('Claude 仅收到未闭合工具调用后结束时不输出可分叉位置', () => {
  const mapper = new ClaudeEventMapper();
  mapper.map({
    ...assistant('tool-message', [{ type: 'tool_use', id: 'tool', name: 'Read', input: {} }]),
    uuid: 'tool-transcript',
  });
  expect(mapper.map({ type: 'result', subtype: 'error_during_execution', session_id: 's1' })[0]).not.toHaveProperty(
    'forkPoint',
  );
});
