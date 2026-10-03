import { describe, expect, it } from 'vitest';
import { CodexEventMapper } from '../../../src/agents/codex/mapper';

describe('Codex 工具与思考事件', () => {
  it('MCP 与文件变更保留工具身份、参数和结果，并去重最终快照', () => {
    const mapper = new CodexEventMapper();
    const mcp = {
      id: 'mcp',
      type: 'mcpToolCall',
      server: 'ssh-server',
      tool: 'remote_exec',
      arguments: { command: 'echo test' },
      status: 'inProgress',
    };
    const changes = [{ path: 'example.ts', kind: { type: 'update' }, diff: '-old\n+new' }];
    const file = { id: 'file', type: 'fileChange', changes, status: 'inProgress' };
    const result = { content: [{ type: 'text', text: '运行完成' }], structuredContent: { exitCode: 0 } };
    expect(mapper.map('item/started', { item: mcp })).toEqual([
      { type: 'tool_call', id: 'mcp', name: 'mcp__ssh-server__remote_exec', input: { command: 'echo test' } },
    ]);
    expect(mapper.map('item/mcpToolCall/progress', { itemId: 'mcp', message: '执行中' })).toEqual([]);
    expect(mapper.map('item/started', { item: file })).toEqual([
      { type: 'tool_call', id: 'file', name: 'fileChange', input: { changes } },
    ]);
    const mcpComplete = { ...mcp, status: 'completed', result, error: null };
    const fileComplete = { ...file, status: 'completed' };
    expect(mapper.map('item/completed', { item: mcpComplete })).toEqual([
      { type: 'tool_result', id: 'mcp', output: JSON.stringify(result), isError: false },
    ]);
    expect(mapper.map('item/completed', { item: fileComplete })).toEqual([
      { type: 'tool_result', id: 'file', output: 'example.ts\n-old\n+new', isError: false },
    ]);
    expect(mapper.finishItems({ items: [mcpComplete, fileComplete] })).toEqual([]);

    const failed = { ...mcp, id: 'mcp-failed', status: 'failed', result: null, error: { message: '同步冲突' } };
    expect(mapper.map('item/completed', { item: failed })).toEqual([
      { type: 'tool_call', id: 'mcp-failed', name: 'mcp__ssh-server__remote_exec', input: { command: 'echo test' } },
      { type: 'tool_result', id: 'mcp-failed', output: '{"message":"同步冲突"}', isError: true },
    ]);
  });

  it('流式思考不重复显示最终全文，历史则保留摘要或正文与多段用户文本', () => {
    const mapper = new CodexEventMapper();
    const reasoning = { id: 'reasoning', type: 'reasoning', summary: ['分析结论'], content: ['内部正文'] };
    expect(mapper.map('item/started', { item: reasoning })).toEqual([]);
    expect(mapper.map('item/reasoning/summaryTextDelta', { itemId: 'reasoning', delta: '分析' })).toEqual([
      { type: 'reasoning', delta: '分析' },
    ]);
    expect(mapper.map('item/reasoning/textDelta', { itemId: 'reasoning', delta: '结论' })).toEqual([
      { type: 'reasoning', delta: '结论' },
    ]);
    expect(mapper.map('item/completed', { item: reasoning })).toEqual([]);
    expect(mapper.finishItems({ items: [reasoning] })).toEqual([]);

    const history = new CodexEventMapper().history({
      status: 'failed',
      items: [
        {
          id: 'user',
          type: 'userMessage',
          content: [
            { type: 'text', text: '第一段' },
            { type: 'image', url: 'ignored' },
            { type: 'text', text: '第二段' },
          ],
        },
        reasoning,
        { id: 'plain-reasoning', type: 'reasoning', summary: [], content: ['正文思考'] },
        { id: 'assistant', type: 'agentMessage', text: '最终回复' },
      ],
    });
    expect(history).toEqual([
      { type: 'user_message', text: '第一段\n第二段' },
      { type: 'reasoning', delta: '分析结论' },
      { type: 'reasoning', delta: '正文思考' },
      { type: 'text', delta: '最终回复' },
      { type: 'turn_end', isError: true },
    ]);
  });
});

describe('Codex 上下文与压缩事件', () => {
  it('上下文只取 last 与通知窗口；缺失值不由累计量或配置推算', () => {
    const mapper = new CodexEventMapper();
    mapper.setModel('actual-model');
    expect(
      mapper.map('thread/tokenUsage/updated', {
        tokenUsage: {
          total: { totalTokens: 40_000 },
          last: { totalTokens: 450 },
          modelContextWindow: 95_000,
        },
      }),
    ).toEqual([
      {
        type: 'context',
        usage: { usedTokens: 450, windowTokens: 95_000, model: 'actual-model', source: 'codex_native' },
      },
    ]);
    expect(
      mapper.map('thread/tokenUsage/updated', {
        tokenUsage: {
          total: { totalTokens: 50_000 },
          last: { totalTokens: 0 },
          modelContextWindow: null,
        },
      }),
    ).toEqual([{ type: 'context', usage: { usedTokens: 0, model: 'actual-model', source: 'codex_native' } }]);
    expect(mapper.map('thread/tokenUsage/updated', { tokenUsage: { total: { totalTokens: 50_000 } } })).toEqual([
      { type: 'context', usage: null },
    ]);
  });

  it('自动压缩完成后，普通轮次后续失败不能改写已完成状态', () => {
    const mapper = new CodexEventMapper();
    mapper.map('thread/tokenUsage/updated', { tokenUsage: { last: { totalTokens: 6000 } } });
    const item = { id: 'auto-compact', type: 'contextCompaction' };
    expect(mapper.map('item/started', { item })).toEqual([
      { type: 'compaction', state: { status: 'running', trigger: 'auto', beforeTokens: 6000 } },
    ]);
    mapper.map('thread/tokenUsage/updated', { tokenUsage: { last: { totalTokens: 2000 } } });
    expect(mapper.map('item/completed', { item })).toEqual([
      { type: 'compaction', state: { status: 'completed', trigger: 'auto', beforeTokens: 6000, afterTokens: 2000 } },
    ]);
    expect(mapper.finishCompaction('failed')).toEqual([]);
    expect(mapper.map('item/completed', { item })).toEqual([]);
  });

  it('手动压缩 item 完成仍等待当前轮次；轮次失败不标成功', () => {
    const mapper = new CodexEventMapper({ manualCompaction: true });
    expect(mapper.startManualCompaction()).toMatchObject([
      { type: 'compaction', state: { status: 'running', trigger: 'manual' } },
    ]);
    const item = { id: 'manual-compact', type: 'contextCompaction' };
    expect(mapper.map('item/started', { item })).toEqual([]);
    expect(mapper.map('item/completed', { item })).toEqual([]);
    expect(mapper.finishCompaction('failed')).toMatchObject([
      { type: 'compaction', state: { status: 'failed', trigger: 'manual' } },
    ]);
    expect(mapper.finishCompaction('completed')).toEqual([]);
  });

  it('历史展示原生压缩边界与纯技能调用，但不猜触发来源或旧 token 数', () => {
    const events = new CodexEventMapper().history({
      status: 'completed',
      items: [
        { id: 'skill-call', type: 'userMessage', content: [{ type: 'skill', name: 'example', path: 'ignored' }] },
        { id: 'history-compact', type: 'contextCompaction' },
      ],
    });
    expect(events).toEqual([
      { type: 'user_message', text: '技能：example' },
      { type: 'compaction', state: { status: 'completed' } },
      { type: 'turn_end', isError: false },
    ]);
  });
});
