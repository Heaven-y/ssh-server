import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createClaudeSubagents, type ClaudeSubagentApi } from '../../../src/agents/claude/subagents';
import { createClaudeSessions } from '../../../src/agents/claude/sessions';

const id = '11111111-1111-4111-8111-111111111111';
const dir = path.join(os.tmpdir(), 'subagent-fixture');
const message = (type: string, content: unknown, stopReason: string | null = 'end_turn') => ({
  type,
  session_id: id,
  uuid: id,
  parent_tool_use_id: 'parent-tool',
  parent_agent_id: 'parent-agent',
  message: { id: 'response', content, stop_reason: stopReason, usage: { input_tokens: 20, output_tokens: 5 } },
});
function setup() {
  const api = {
    list: vi.fn(async () => ['child-1', '../outside', 'child-1', 'child-2']),
    messages: vi.fn<ClaudeSubagentApi['messages']>(async () => [
      message('user', [{ type: 'text', text: '检查函数' }]),
      message('assistant', [{ type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'demo.ts' } }]),
      message('user', [{ type: 'tool_result', tool_use_id: 'read', content: '源码' }]),
      message('assistant', [{ type: 'text', text: '检查完成' }]),
    ]),
  };
  return { api, read: createClaudeSubagents(api) };
}
describe('Claude 子代理原生历史', () => {
  it('按需枚举和读取独立记录，保留嵌套来源、工具与用量，不产生父会话分叉点', async () => {
    const { api, read } = setup();
    expect(await read(id, dir, {})).toEqual({ agentIds: ['child-1', 'child-2'] });
    expect(api.messages).not.toHaveBeenCalled();
    const history = await read(id, dir, { agentId: 'child-1' });
    expect(history).toMatchObject({
      agentId: 'child-1',
      parentAgentId: 'parent-agent',
      events: [
        { type: 'user_message', text: '检查函数' },
        { type: 'tool_call', id: 'read' },
        { type: 'tool_result', id: 'read', output: '源码' },
        { type: 'text', delta: '检查完成' },
        { type: 'step_usage', usage: { inputTokens: 20, outputTokens: 5 } },
        { type: 'turn_end', isError: false },
      ],
    });
    if ('events' in history) expect(history.events.some((event) => 'forkPoint' in event)).toBe(false);
  });
  it('分页使用原生 offset，多读一条判定下一页，不把预算伪装为记录终点', async () => {
    const { api, read } = setup();
    api.messages.mockResolvedValue(Array.from({ length: 101 }, () => message('user', '下一条')));
    const result = await read(id, dir, { agentId: 'child-1', cursor: '100' });
    expect(api.messages).toHaveBeenCalledWith(id, 'child-1', dir, { limit: 101, offset: 100 });
    expect(result).toMatchObject({ nextCursor: '200' });
    if ('events' in result) expect(result.events).toHaveLength(100);
  });
  it('页尾跨页的同一 API 回复整体留到下页，统计只在完整正文之后', async () => {
    const { api, read } = setup();
    const first = message('assistant', [{ type: 'text', text: '第一段' }], null);
    const last = message('assistant', [{ type: 'text', text: '第二段' }]);
    const records = [...Array.from({ length: 99 }, () => message('user', '前面的消息')), first, last];
    api.messages.mockImplementation(async (_id, _agentId, _dir, page) =>
      records.slice(page.offset, page.offset + page.limit),
    );
    const page1 = await read(id, dir, { agentId: 'child-1' });
    expect(page1).toMatchObject({ nextCursor: '99' });
    if ('events' in page1) expect(page1.events).toHaveLength(99);
    const page2 = await read(id, dir, { agentId: 'child-1', cursor: '99' });
    expect(page2).not.toHaveProperty('nextCursor');
    if ('events' in page2)
      expect(page2.events.map((event) => event.type)).toEqual(['text', 'text', 'step_usage', 'turn_end']);
  });
  it('页头的单条长回复有界扩读到完整边界，游标按实际返回条数推进', async () => {
    const { api, read } = setup();
    const records = [
      ...Array.from({ length: 150 }, () => message('assistant', [{ type: 'text', text: '内容块' }])),
      message('user', '下一轮'),
    ];
    api.messages.mockImplementation(async (_id, _agentId, _dir, page) =>
      records.slice(page.offset, page.offset + page.limit),
    );
    const result = await read(id, dir, { agentId: 'child-1' });
    expect(api.messages).toHaveBeenNthCalledWith(1, id, 'child-1', dir, { offset: 0, limit: 101 });
    expect(api.messages).toHaveBeenNthCalledWith(2, id, 'child-1', dir, { offset: 0, limit: 1001 });
    expect(result).toMatchObject({ nextCursor: '150' });
    if ('events' in result) expect(result.events.filter((event) => event.type === 'text')).toHaveLength(150);
  });
  it('单条回复超过完整读取上限时明确失败，不静默截断或返回不前进的游标', async () => {
    const { api, read } = setup();
    api.messages.mockImplementation(async (_id, _agentId, _dir, page) =>
      Array.from({ length: page.limit }, () => message('assistant', [{ type: 'text', text: '内容块' }])),
    );
    await expect(read(id, dir, { agentId: 'child-1' })).rejects.toMatchObject({ status: 503 });
    expect(api.messages).toHaveBeenCalledTimes(2);
  });
  it('拒绝未枚举 ID 和取消后迟到的记录', async () => {
    const { api, read } = setup();
    await expect(read(id, dir, { agentId: '../outside' })).rejects.toMatchObject({ status: 404 });
    expect(api.messages).not.toHaveBeenCalled();
    const controller = new AbortController();
    api.list.mockImplementation(async () => {
      controller.abort();
      return ['child-1'];
    });
    await expect(read(id, dir, { agentId: 'child-1' }, controller.signal)).rejects.toThrow();
    expect(api.messages).not.toHaveBeenCalled();
  });
  it('父会话目录核验失败时不触及子代理目录', async () => {
    const { api } = setup();
    const provider = createClaudeSessions(
      {
        info: async () => ({ sessionId: id, summary: '父会话', lastModified: 1, cwd: path.join(dir, 'other') }),
        list: async () => [],
        messages: async () => [],
        rename: async () => {},
        delete: async () => {},
        fork: async () => ({ sessionId: id }),
      },
      api,
    );
    await expect(provider.subagents!(id, dir, {})).rejects.toMatchObject({ status: 404 });
    expect(api.list).not.toHaveBeenCalled();
  });
});
