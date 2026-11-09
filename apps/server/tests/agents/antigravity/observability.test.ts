import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { AntigravityMapper } from '../../../src/agents/antigravity/mapper';
import { antigravityHistory } from '../../../src/agents/antigravity/history';

it('原生 ERROR 工具步骤及时结束并显示错误，重复事件去重，取消不伪装成功', () => {
  const cwd = path.join(tmpdir(), 'agentdeck-error-observability');
  const mapper = new AntigravityMapper(cwd);
  mapper.map({ event: 'init', conversation_id: 'session', init: { cwd } });
  const step = { conversation_id: 'session', step_index: 2, step_type: 'tool', tool_name: 'write_file' };
  expect(mapper.map({ event: 'step_update', step_update: { ...step, state: 'ACTIVE' } })).toMatchObject([
    { type: 'tool_call', id: 'agy-step-2' },
  ]);
  const failed = {
    event: 'step_update',
    step_update: {
      ...step,
      state: 'ERROR',
      duration_seconds: 0.02,
      tool_info: { name: 'write_file', error: { type: 'TOOL_ERROR', message: '文件不可写' } },
    },
  };
  expect(mapper.map(failed)).toEqual([
    {
      type: 'tool_result',
      id: 'agy-step-2',
      output: '文件不可写',
      isError: true,
      durationMs: 20,
      timingSource: 'native',
    },
  ]);
  expect(mapper.map(failed)).toEqual([]);
  expect(mapper.map({ event: 'step_update', step_update: { ...step, step_index: 3, state: 'CANCELLED' } })).toEqual([
    { type: 'tool_call', id: 'agy-step-3', name: 'write_file', input: {} },
  ]);
});

it('按原生步骤统计并去重，不把累计结果冒充本轮 token 或耗时', () => {
  const cwd = path.join(tmpdir(), 'agentdeck-observability');
  const mapper = new AntigravityMapper(cwd);
  mapper.map({ event: 'init', conversation_id: 'session', init: { cwd } });
  const update = {
    event: 'step_update',
    step_update: {
      conversation_id: 'session',
      step_type: 'agent_response',
      step_index: 1,
      state: 'DONE',
      duration_seconds: 2,
      usage: { input_tokens: 100, output_tokens: 20, thinking_tokens: 5 },
    },
  };
  expect(mapper.map(update)).toEqual([
    {
      type: 'step_usage',
      id: 'agy-step-1',
      durationMs: 2000,
      timingSource: 'native',
      usage: { source: 'antigravity', scope: 'step', inputTokens: 100, outputTokens: 20, reasoningOutputTokens: 5 },
    },
  ]);
  expect(mapper.map(update)).toEqual([]);
  mapper.map({
    event: 'result',
    result: { conversation_id: 'session', status: 'SUCCESS', duration_seconds: 999, usage: { output_tokens: 9000 } },
  });
  expect(mapper.result).toEqual({ type: 'turn_end', isError: false });
});

it('子代理保留可见摘要和状态，不回传日志路径或工作区列表', () => {
  const cwd = path.join(tmpdir(), 'agentdeck-subagent-observability');
  const mapper = new AntigravityMapper(cwd);
  mapper.map({ event: 'init', conversation_id: 'session', init: { cwd } });
  const update = {
    event: 'step_update',
    step_update: {
      conversation_id: 'session',
      step_index: 2,
      state: 'ACTIVE',
      step_type: 'tool',
      subagent_info: {
        subagents: [
          {
            type_name: 'explorer',
            role: '读取文件',
            conversation_id: 'child',
            log_uri: 'hidden-log',
            workspace_uris: ['hidden-workspace'],
          },
        ],
      },
    },
  };
  const events = mapper.map(update);
  expect(events).toMatchObject([{ type: 'activity', id: 'agy-step-2', name: '子代理', status: 'running' }]);
  expect(JSON.stringify(events)).not.toContain('hidden-');
  expect(mapper.map(update)).toEqual([]);
});

it('回放工具、文件、错误和压缩，保留原生耗时，隐藏内部诊断与思考签名', () => {
  const done = 'CORTEX_STEP_STATUS_DONE';
  const events = antigravityHistory({
    steps: [
      { type: 'CORTEX_STEP_TYPE_USER_INPUT', status: done, userInput: { query: '示例任务' } },
      {
        type: 'CORTEX_STEP_TYPE_RUN_COMMAND',
        status: done,
        metadata: { startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:02Z' },
        runCommand: {
          commandLine: 'echo demo',
          exitCode: 1,
          combinedOutput: { full: 'demo' },
          rawDebugOutput: 'hidden-debug',
        },
      },
      {
        type: 'CORTEX_STEP_TYPE_VIEW_FILE',
        status: done,
        viewFile: { absolutePathUri: pathToFileURL(path.join(tmpdir(), 'demo.txt')).href, content: '示例文件' },
      },
      {
        type: 'CORTEX_STEP_TYPE_MCP_TOOL',
        status: done,
        mcpTool: {
          serverName: 'my-server',
          toolCall: { name: 'lookup', argumentsJson: '{"query":"example"}' },
          resultString: '找到一项',
        },
      },
      {
        type: 'CORTEX_STEP_TYPE_GENERIC',
        status: done,
        generic: { args: { query: 'demo' }, result: { result: '输出', payload: { secret: 'hidden-any' } } },
      },
      {
        type: 'CORTEX_STEP_TYPE_ERROR_MESSAGE',
        status: done,
        errorMessage: { shouldShowUser: true, error: { userErrorMessage: '可见错误', fullError: 'hidden-error' } },
      },
      { type: 'CORTEX_STEP_TYPE_CHECKPOINT', status: done, checkpoint: {} },
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        status: done,
        plannerResponse: { response: '完成', rawThinking: 'hidden-thinking', signature: 'hidden-signature' },
      },
      { type: 'CORTEX_STEP_TYPE_NEW_ACTIVITY', status: done, customExtensions: { payload: 'hidden-payload' } },
    ],
    generatorMetadata: [
      {
        chatModel: {
          chatStartMetadata: { contextWindowMetadata: { estimatedTokensUsed: 1000, maxContextTokens: 10000 } },
        },
      },
    ],
  });
  expect(events).toContainEqual({
    type: 'tool_result',
    id: 'agy-step-1',
    output: 'demo',
    isError: true,
    durationMs: 2000,
    timingSource: 'native',
  });
  expect(events).toContainEqual({ type: 'tool_result', id: 'agy-step-2', output: '示例文件', isError: false });
  expect(events).toContainEqual({ type: 'error', message: '可见错误' });
  expect(events).toContainEqual({ type: 'compaction', state: { status: 'completed' } });
  expect(events.at(-1)).toEqual({
    type: 'context',
    usage: { source: 'antigravity_estimate', usedTokens: 1000, windowTokens: 10000, percentage: 10 },
  });
  expect(JSON.stringify(events)).not.toContain('hidden-');
  expect(events).toContainEqual({
    type: 'activity',
    id: 'agy-step-8',
    name: 'NEW_ACTIVITY',
    status: 'completed',
    input: { type: 'CORTEX_STEP_TYPE_NEW_ACTIVITY', status: done },
  });
});

it('未完成工具和缺失统计不填零，不生成成功结果或 tok/s', () => {
  const events = antigravityHistory({
    steps: [
      {
        type: 'CORTEX_STEP_TYPE_RUN_COMMAND',
        status: 'CORTEX_STEP_STATUS_INTERRUPTED',
        runCommand: { commandLine: 'demo' },
      },
    ],
  });
  expect(events.map((event) => event.type)).toEqual(['tool_call', 'turn_end']);
  expect(events.at(-1)).not.toHaveProperty('forkPoint');
  expect(events.at(-1)).not.toHaveProperty('usage');
  expect(events.at(-1)).not.toHaveProperty('durationMs');
});
