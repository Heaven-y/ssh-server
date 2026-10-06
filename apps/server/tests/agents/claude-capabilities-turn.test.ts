import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, Workspace } from '@ssh-server/shared';
import type { SDKUserMessage, SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import { runClaudeTurn, type QueryFn } from '../../src/agents/claude-adapter';
import { CLAUDE_SUMMARY_TIMEOUT_MS, type ClaudeQuery } from '../../src/agents/claude-query';

const workspace: Workspace = {
  id: 'w1',
  name: 'demo',
  localDir: path.join(os.tmpdir(), 'ssh-server-fixture', 'demo'),
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
};
const compact = { name: 'compact', description: '原生压缩', argumentHint: '', builtin: true };
const skill = { name: 'fixture', description: '原生技能', argumentHint: '<任务>' };
const result = { type: 'result', subtype: 'success', is_error: false };
const running = { type: 'system', subtype: 'status', status: 'compacting' };
const manual = { kind: 'command', name: 'compact' } as const;
const selectedSkill = { kind: 'skill', name: 'fixture' } as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function contextUsage(overrides: Partial<SDKControlGetContextUsageResponse> = {}): SDKControlGetContextUsageResponse {
  return {
    totalTokens: 120,
    rawMaxTokens: 200000,
    maxTokens: 200000,
    percentage: 0,
    model: 'native-model',
    categories: [],
    gridRows: [],
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    isAutoCompactEnabled: true,
    apiUsage: null,
    ...overrides,
  };
}
type Controls = Partial<Pick<ClaudeQuery, 'supportedCommands' | 'getContextUsage' | 'interrupt'>>;
function controlledQuery(source: Iterable<unknown> | AsyncIterable<unknown> = [result], controls: Controls = {}) {
  const received: SDKUserMessage[] = [];
  const timeline: string[] = [];
  const ready = deferred<void>();
  let closed = false;
  let iterator: AsyncIterator<SDKUserMessage>;
  const queryFn: QueryFn = ({ prompt }) => {
    iterator = prompt[Symbol.asyncIterator]();
    const first = iterator.next().then((step) => {
      if (!step.done) {
        received.push(step.value);
        timeline.push('input');
        ready.resolve();
      }
      return step;
    });
    return Object.assign(
      (async function* () {
        if ((await first).done) return;
        for await (const message of source) yield message;
      })(),
      {
        interrupt: async () => undefined,
        supportedModels: async () => [],
        supportedCommands: async () => {
          timeline.push('commands');
          return [skill, compact];
        },
        getContextUsage: async () => {
          timeline.push('summary');
          return contextUsage();
        },
        close() {
          closed = true;
          timeline.push('close');
        },
        ...controls,
      },
    );
  };
  return {
    queryFn,
    received,
    timeline,
    ready: ready.promise,
    get closed() {
      return closed;
    },
    nextInput: () => iterator.next(),
  };
}
function run(fake: ReturnType<typeof controlledQuery>, extra: Partial<Parameters<typeof runClaudeTurn>[0]> = {}) {
  const events: AgentEvent[] = [];
  const handle = runClaudeTurn({
    workspace,
    text: '任务说明',
    mcpEnv: {},
    emit: (event) => events.push(event),
    requestPermission: async () => ({ allow: false }),
    queryFn: fake.queryFn,
    ...extra,
  });
  return { handle, events };
}
afterEach(() => vi.useRealTimers());

describe('Claude 能力轮次', () => {
  it('同一 Query 校验技能后只投递一条消息，result 后读取 summary 再关闭输入', async () => {
    const fake = controlledQuery();
    const { handle, events } = run(fake, { invocation: selectedSkill });
    await handle.done;
    expect(fake.received.map((message) => message.message.content)).toEqual(['/fixture 任务说明']);
    expect(fake.timeline.slice(0, 4)).toEqual(['commands', 'input', 'summary', 'close']);
    expect(events).toContainEqual({
      type: 'context',
      usage: { usedTokens: 120, windowTokens: 200000, percentage: 0, model: 'native-model', source: 'claude_estimate' },
    });
    expect(fake.closed).toBe(true);
    expect((await fake.nextInput()).done).toBe(true);
  });

  it.each([
    { name: '技能消失', invocation: selectedSkill, commands: [] },
    { name: '技能被内置命令覆盖', invocation: selectedSkill, commands: [{ ...skill, builtin: true }] },
    { name: '技能同名歧义', invocation: selectedSkill, commands: [skill, skill] },
    { name: '压缩被技能覆盖', invocation: manual, commands: [{ ...compact, builtin: false }] },
    { name: '压缩重复精确名', invocation: manual, commands: [compact, { ...compact, builtin: false }] },
    { name: '压缩别名歧义', invocation: manual, commands: [compact, { ...skill, aliases: ['compact'] }] },
  ])('$name 时拒绝投递，不将调用降级成普通提示词', async ({ invocation, commands }) => {
    const fake = controlledQuery([result], { supportedCommands: async () => commands });
    const { handle, events } = run(fake, { invocation, sessionId: 's1' });
    await handle.done;
    expect(fake.received).toEqual([]);
    expect(fake.closed).toBe(true);
    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', isError: true });
  });

  it('context 仅查询 summary，不发送任何用户消息', async () => {
    const read = vi.fn(async () => contextUsage({ totalTokens: 99, rawMaxTokens: 1000, percentage: 10 }));
    const fake = controlledQuery([], { getContextUsage: read });
    const { handle, events } = run(fake, {
      sessionId: 's1',
      invocation: { kind: 'command', name: 'context' },
      text: '',
    });
    await handle.done;
    expect(read).toHaveBeenCalledWith({ detail: 'summary' });
    expect(fake.received).toEqual([]);
    expect(fake.closed).toBe(true);
    expect(events[0]).toMatchObject({
      type: 'context',
      usage: { usedTokens: 99, windowTokens: 1000, percentage: 10, source: 'claude_estimate' },
    });
  });

  it('summary 超时返回不可用，不丢失普通轮次成功并关闭进程', async () => {
    vi.useFakeTimers();
    const readStarted = deferred<void>();
    const fake = controlledQuery([result], {
      getContextUsage: () => {
        readStarted.resolve();
        return new Promise(() => undefined);
      },
    });
    const { handle, events } = run(fake);
    await readStarted.promise;
    await vi.advanceTimersByTimeAsync(CLAUDE_SUMMARY_TIMEOUT_MS);
    await handle.done;
    expect(events).toContainEqual({ type: 'context', usage: null });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', isError: false });
    expect(fake.closed).toBe(true);
    expect((await fake.nextInput()).done).toBe(true);
  });

  it('能力校验等待期间取消，不发消息并释放输入和 Query', async () => {
    const fake = controlledQuery([result], { supportedCommands: () => new Promise(() => undefined) });
    const { handle } = run(fake, { invocation: selectedSkill });
    await handle.interrupt();
    await handle.done;
    expect(fake.received).toEqual([]);
    expect(fake.closed).toBe(true);
    expect((await fake.nextInput()).done).toBe(true);
  });

  it.each([
    {
      name: '原生压缩失败',
      messages: [running, { type: 'system', subtype: 'status', status: null, compact_result: 'failed' }, result],
    },
    {
      name: '没有压缩边界的空会话',
      messages: [
        { type: 'assistant', message: { content: [{ type: 'text', text: 'No messages to compact' }] } },
        result,
      ],
    },
  ])('$name 不因顶层 result success 误报成功', async ({ messages }) => {
    const fake = controlledQuery(messages);
    const { handle, events } = run(fake, { invocation: manual, sessionId: 's1', text: '' });
    await handle.done;
    expect(events.filter((event) => event.type === 'compaction').at(-1)).toMatchObject({
      state: { status: 'failed', trigger: 'manual' },
    });
    expect(events.filter((event) => event.type === 'text')).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', isError: true });
  });

  it('运行中的压缩中断通过原生 interrupt 结束，并保留 cancelled 状态', async () => {
    const waiting = deferred<void>();
    const inCompaction = deferred<void>();
    const interrupt = vi.fn(async () => {
      waiting.resolve();
      return undefined;
    });
    const source = (async function* () {
      yield running;
      inCompaction.resolve();
      await waiting.promise;
      yield { type: 'system', subtype: 'status', status: null, compact_result: 'failed' };
      yield result;
    })();
    const fake = controlledQuery(source, { interrupt });
    const { handle, events } = run(fake, { invocation: manual, sessionId: 's1', text: '' });
    await inCompaction.promise;
    await handle.interrupt();
    await handle.done;
    expect(interrupt).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.type === 'compaction').at(-1)).toMatchObject({
      state: { status: 'cancelled', trigger: 'manual' },
    });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', isError: true });
    expect(fake.closed).toBe(true);
  });

  it('手动压缩成功后不追加重放的旧回复和旧失败文本', async () => {
    const events: AgentEvent[] = [];
    const queryFn: QueryFn = () =>
      Object.assign(
        (async function* () {
          yield { type: 'system', subtype: 'status', status: 'compacting' };
          yield { type: 'system', subtype: 'status', status: null, compact_result: 'success' };
          yield {
            type: 'system',
            subtype: 'compact_boundary',
            compact_metadata: { trigger: 'manual', pre_tokens: 100, post_tokens: 50 },
          };
          yield {
            type: 'assistant',
            uuid: 'old-reply',
            message: { id: 'old-model-id', content: [{ type: 'text', text: '旧失败回复' }] },
            local_command_outcome: { kind: 'failed' },
          };
          yield result;
        })(),
        {
          interrupt: async () => undefined,
          supportedCommands: async () => [compact],
          supportedModels: async () => [],
          getContextUsage: async () => contextUsage(),
          close() {},
        },
      );
    const handle = runClaudeTurn({
      workspace,
      text: '',
      sessionId: 's1',
      invocation: { kind: 'command', name: 'compact' },
      mcpEnv: {},
      emit: (event) => events.push(event),
      requestPermission: async () => ({ allow: false }),
      queryFn,
    });
    await handle.done;
    expect(events.filter((event) => event.type === 'text')).toEqual([]);
    expect(events.filter((event) => event.type === 'compaction')).toMatchObject([
      { state: { status: 'running', trigger: 'manual' } },
      { state: { status: 'completed', trigger: 'manual' } },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', isError: false });
  });
  it.each([null, {}, { totalTokens: -1 }])('原生summary空值或坏数据不伪造占用：%j', async (value) => {
    // 模拟原生运行时返回与声明不符的数据，校验边界必须保留。
    const fake = controlledQuery([result], {
      getContextUsage: async () => value as SDKControlGetContextUsageResponse,
    });
    const { handle, events } = run(fake);
    await handle.done;
    expect(events).toContainEqual({ type: 'context', usage: null });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', isError: false });
    expect(fake.closed).toBe(true);
  });

  it('context控制调用失败仍正常关闭并标记本次查询失败', async () => {
    const fake = controlledQuery([], {
      getContextUsage: async () => {
        throw new Error('原生控制失败');
      },
    });
    const { handle, events } = run(fake, { sessionId: 's1', invocation: { kind: 'command', name: 'context' } });
    await handle.done;
    expect(events).toContainEqual({ type: 'context', usage: null });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', isError: true });
    expect(fake.closed).toBe(true);
  });

  it('Query尚未创建即抛错仍能收尾', async () => {
    const { handle, events } = run(controlledQuery(), {
      queryFn: () => {
        throw new Error('初始化失败');
      },
    });
    await handle.done;
    expect(events).toEqual([
      { type: 'error', message: '初始化失败' },
      { type: 'turn_end', isError: true },
    ]);
  });
});
