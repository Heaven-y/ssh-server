import { describe, expect, it } from 'vitest';
import { ClaudeEventMapper } from './claude-mapper';

const stream = (event: unknown) => ({ type: 'stream_event', event, parent_tool_use_id: null, session_id: 's1' });
const delta = (d: unknown) => stream({ type: 'content_block_delta', index: 0, delta: d });
const assistant = (id: string, content: unknown[], parent: string | null = null) => ({
  type: 'assistant',
  message: { id, role: 'assistant', content },
  parent_tool_use_id: parent,
  session_id: 's1',
});
const user = (content: unknown) => ({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: 's1' });

describe('ClaudeEventMapper.map', () => {
  it('init → session', () => {
    const m = new ClaudeEventMapper();
    expect(m.map({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-x', cwd: 'E:\\w', parent_tool_use_id: null })).toEqual([
      { type: 'session', sessionId: 's1', model: 'claude-x', cwd: 'E:\\w' },
    ]);
  });

  it('text_delta → text，thinking_delta → reasoning', () => {
    const m = new ClaudeEventMapper();
    expect(m.map(delta({ type: 'text_delta', text: '你' }))).toEqual([{ type: 'text', delta: '你' }]);
    expect(m.map(delta({ type: 'thinking_delta', thinking: '想' }))).toEqual([{ type: 'reasoning', delta: '想' }]);
  });

  it('assistant 中的 tool_use → tool_call', () => {
    const m = new ClaudeEventMapper();
    const evs = m.map(assistant('m1', [{ type: 'tool_use', id: 't1', name: 'mcp__ssh-server__remote_exec', input: { command: 'ls' } }]));
    expect(evs).toEqual([{ type: 'tool_call', id: 't1', name: 'mcp__ssh-server__remote_exec', input: { command: 'ls' } }]);
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
    const evs = m.map(user([{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '退出码：0' }], is_error: true }]));
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
    expect(m.map({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1200, total_cost_usd: 0.02 })).toEqual([
      { type: 'turn_end', isError: false, durationMs: 1200, costUsd: 0.02 },
    ]);
    expect(m.map({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 5, total_cost_usd: 0 })[0]).toMatchObject({
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
  it('用户文本 → user_message（字符串或 text 块）', () => {
    const m = new ClaudeEventMapper();
    expect(m.mapHistory({ type: 'user', message: { role: 'user', content: '帮我看看' }, parent_tool_use_id: null })).toEqual([
      { type: 'user_message', text: '帮我看看' },
    ]);
    expect(m.mapHistory({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '第二句' }] }, parent_tool_use_id: null })).toEqual([
      { type: 'user_message', text: '第二句' },
    ]);
  });

  it('只有 tool_result 的用户消息不产生 user_message', () => {
    const m = new ClaudeEventMapper();
    const evs = m.mapHistory({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }, parent_tool_use_id: null });
    expect(evs).toEqual([{ type: 'tool_result', id: 't1', output: 'ok', isError: false }]);
  });

  it('助手文本总是输出', () => {
    const m = new ClaudeEventMapper();
    expect(m.mapHistory({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: '答' }] }, parent_tool_use_id: null })).toEqual([
      { type: 'text', delta: '答' },
    ]);
  });
});
