import { describe, expect, it } from 'vitest';
import { CodexEventMapper, turnEnd } from '../../../src/agents/codex/mapper';
import { emptyCodexUsage } from '../../../src/agents/codex/observability';

describe('Codex 工具与思考事件', () => {
  it('MCP 与文件变更保留工具身份、参数和结果，并去重最终快照', () => {
    const mapper = new CodexEventMapper();
    const mcp = {
      id: 'mcp',
      type: 'mcpToolCall',
      server: 'my-server',
      tool: 'remote_exec',
      arguments: { command: 'echo test' },
      status: 'inProgress',
    };
    const changes = [{ path: 'example.ts', kind: { type: 'update' }, diff: '-old\n+new' }];
    const file = { id: 'file', type: 'fileChange', changes, status: 'inProgress' };
    const result = { content: [{ type: 'text', text: '运行完成' }], structuredContent: { exitCode: 0 } };
    expect(mapper.map('item/started', { item: mcp })).toEqual([
      { type: 'tool_call', id: 'mcp', name: 'mcp__my-server__remote_exec', input: { command: 'echo test' } },
    ]);
    expect(mapper.map('item/mcpToolCall/progress', { itemId: 'mcp', message: '执行中' })).toEqual([
      { type: 'tool_progress', id: 'mcp', message: '执行中' },
    ]);
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
      { type: 'tool_call', id: 'mcp-failed', name: 'mcp__my-server__remote_exec', input: { command: 'echo test' } },
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

describe('Codex 原生分叉点', () => {
  it.each(['completed', 'failed', 'interrupted'])('历史和实时结束保留 %s 轮次的原生 ID', (status) => {
    const turn = { id: 'native-turn-id', status, items: [] };
    expect(turnEnd(turn)).toMatchObject({ type: 'turn_end', forkPoint: 'native-turn-id' });
    expect(new CodexEventMapper().history(turn)).toEqual([
      { type: 'turn_end', isError: status !== 'completed', forkPoint: 'native-turn-id' },
    ]);
  });

  it.each([
    { id: 'running-turn', status: 'inProgress' },
    { id: 'unknown-state', status: 'unknown' },
    { id: '../not-an-id', status: 'completed' },
    { status: 'completed' },
  ])('未确认结束或没有有效原生身份时不生成分叉点：%j', (turn) => {
    expect(turnEnd(turn)).not.toHaveProperty('forkPoint');
    expect(new CodexEventMapper().history({ ...turn, items: [] }).at(-1)).not.toHaveProperty('forkPoint');
  });
});

describe('Codex 用量与执行轨迹', () => {
  const report = (mapper: CodexEventMapper, input: number, output: number, lastOutput = output) =>
    mapper.map('thread/tokenUsage/updated', {
      tokenUsage: {
        total: { inputTokens: input, outputTokens: output, totalTokens: input + output },
        last: { totalTokens: 10 + lastOutput, outputTokens: lastOutput },
        modelContextWindow: 1000,
      },
    });

  it('按轮次基线取累计增量，重复通知不相加，恢复首轮与计数重置不伪造用量', () => {
    const first = new CodexEventMapper();
    first.beginUsage(emptyCodexUsage());
    report(first, 50, 20);
    report(first, 90, 30, 10);
    report(first, 90, 30, 10);
    expect(first.turnUsage()).toEqual({
      source: 'codex',
      scope: 'turn',
      inputTokens: 90,
      outputTokens: 30,
      totalTokens: 120,
    });
    const resumed = new CodexEventMapper();
    resumed.beginUsage();
    report(resumed, 500, 100);
    expect(resumed.turnUsage()).toBeUndefined();
    const next = new CodexEventMapper();
    next.beginUsage(resumed.cumulativeUsage());
    report(next, 600, 130, 5);
    expect(next.turnUsage()).toMatchObject({ inputTokens: 100, outputTokens: 30, totalTokens: 130 });
    report(next, 20, 10);
    report(next, 1000, 200);
    expect(next.turnUsage()).toBeUndefined();
  });

  it('缺失字段不以零填充，缺失总量会使本轮统计失效', () => {
    const mapper = new CodexEventMapper();
    mapper.beginUsage({ inputTokens: 10, totalTokens: 20 });
    report(mapper, 30, 10);
    expect(mapper.turnUsage()).toEqual({ source: 'codex', scope: 'turn', inputTokens: 20, totalTokens: 20 });
    mapper.map('thread/tokenUsage/updated', { tokenUsage: { last: { totalTokens: 100 } } });
    report(mapper, 40, 20);
    expect(mapper.turnUsage()).toBeUndefined();
    mapper.beginUsage({ inputTokens: 30, outputTokens: 20 });
    mapper.map('thread/tokenUsage/updated', { tokenUsage: { total: { outputTokens: 25 } } });
    report(mapper, 10, 30);
    expect(mapper.turnUsage()).toBeUndefined();
  });

  it('压缩开始后没有新用量通知时，不将压缩前快照用作结束基线', () => {
    const mapper = new CodexEventMapper();
    mapper.beginUsage(emptyCodexUsage());
    report(mapper, 100, 20);
    const item = { id: 'compact', type: 'contextCompaction' };
    mapper.map('item/started', { item });
    mapper.map('item/completed', { item });
    expect(mapper.turnUsage()).toBeUndefined();
    expect(mapper.cumulativeUsage()).toBeUndefined();
    report(mapper, 150, 30);
    expect(mapper.turnUsage()).toMatchObject({ inputTokens: 150, outputTokens: 30 });
  });

  it.each([undefined, null, 'inProgress', 'queued', 'unknown'])('工具状态 %s 不会被完成快照误标成功', (status) => {
    const item = { id: 'command', type: 'commandExecution', command: 'demo', status };
    const mapper = new CodexEventMapper();
    expect(mapper.map('item/started', { item })).toHaveLength(1);
    expect(mapper.map('item/completed', { item })).toEqual([]);
    expect(mapper.finishItems({ status: 'completed', items: [item] })).toEqual([]);
    expect(
      new CodexEventMapper()
        .history({ status: 'completed', items: [item] })
        .some((event) => event.type === 'tool_result'),
    ).toBe(false);
  });

  it('中断轮次保留分叉点但标为非成功，未确认结束的无状态步骤不补结果', () => {
    const usage = { source: 'codex' as const, scope: 'turn' as const, outputTokens: 50 };
    expect(turnEnd({ id: 'interrupted-turn', status: 'interrupted', durationMs: 100 }, usage)).toMatchObject({
      isError: true,
      forkPoint: 'interrupted-turn',
      usage,
    });
    const item = { id: 'web', type: 'webSearch', query: '示例' };
    expect(new CodexEventMapper().finishItems({ status: 'interrupted', items: [item] })).toMatchObject([
      { type: 'tool_call' },
    ]);
    expect(
      new CodexEventMapper()
        .history({ status: 'interrupted', items: [item] })
        .some((event) => event.type === 'tool_result'),
    ).toBe(false);
  });

  it('搜索、计划、动态工具与协作保留原生输出，起止时间只在完整有效时转为耗时', () => {
    const mapper = new CodexEventMapper();
    const search = { id: 'search', type: 'webSearch', query: '示例', startedAtMs: 100 };
    expect(mapper.map('item/started', { item: search })[0]).toMatchObject({
      name: 'webSearch',
      input: { query: '示例' },
    });
    expect(
      mapper.map('item/completed', { item: { ...search, startedAtMs: null, completedAtMs: 135 } })[0],
    ).toMatchObject({ durationMs: 35, timingSource: 'native' });
    const history = new CodexEventMapper().history({
      status: 'completed',
      items: [
        { id: 'plan', type: 'plan', text: '执行检查' },
        {
          id: 'dynamic',
          type: 'dynamicToolCall',
          status: 'failed',
          tool: 'demo',
          arguments: {},
          success: false,
          durationMs: 25,
          contentItems: [{ type: 'inputText', text: '失败原因' }],
        },
        {
          id: 'collab',
          type: 'collabAgentToolCall',
          status: 'completed',
          tool: 'spawnAgent',
          agentsStates: { child: { status: 'completed' } },
        },
      ],
    });
    expect(history).toContainEqual({ type: 'tool_result', id: 'plan', output: '执行检查', isError: false });
    expect(history).toContainEqual({
      type: 'tool_result',
      id: 'dynamic',
      output: '失败原因',
      isError: true,
      durationMs: 25,
      timingSource: 'native',
    });
    expect(history).toContainEqual({
      type: 'tool_result',
      id: 'collab',
      output: '{"child":{"status":"completed"}}',
      isError: false,
    });
    expect(
      mapper.map('item/completed', { item: { id: 'missing-time', type: 'imageView', path: 'demo.png' } }).at(-1),
    ).not.toHaveProperty('durationMs');
    expect(
      new CodexEventMapper()
        .history({ items: [{ id: 'still-running', type: 'commandExecution', status: 'inProgress' }] })
        .filter((event) => event.type === 'tool_result'),
    ).toEqual([]);
  });
});
