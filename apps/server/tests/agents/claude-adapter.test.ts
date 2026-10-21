import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, Workspace } from '@ssh-server/shared';
import { PERMISSION_TIMEOUT_MS, runClaudeTurn, type QueryFn } from '../../src/agents/claude-adapter';

const ws: Workspace = {
  id: 'w1',
  name: 'demo',
  localDir: path.join(os.tmpdir(), 'ssh-server-fixture', 'demo'),
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
};
const mcpEnv = { SSH_SERVER_INTERNAL_URL: 'http://127.0.0.1:1', SSH_SERVER_SESSION_TOKEN: 'tok' };

type CanUseTool = (
  name: string,
  input: Record<string, unknown>,
  o: { signal: AbortSignal },
) => Promise<{ behavior: string; message?: string }>;

function fakeQuery(messages: unknown[] = [], fail?: Error, models: ModelInfo[] | Error = [], hold = false) {
  const state: {
    options?: Record<string, unknown>;
    prompt?: unknown;
    interrupted: boolean;
    release?: () => void;
  } = { interrupted: false };
  const gate = hold
    ? new Promise<void>((resolve) => {
        state.release = resolve;
      })
    : undefined;
  const queryFn: QueryFn = ({ prompt, options }) => {
    state.options = options;
    async function* gen() {
      const first = await prompt[Symbol.asyncIterator]().next();
      if (first.done) return;
      state.prompt = first.value.message.content;
      for (const m of messages) yield m;
      if (fail) throw fail;
      if (gate) await gate;
    }
    return Object.assign(gen(), {
      close: vi.fn(() => state.release?.()),
      supportedCommands: async () => [],
      supportedModels: async () => {
        if (models instanceof Error) throw models;
        return models;
      },
      getContextUsage: async () => {
        throw new Error('原生上下文暂不可用');
      },
      interrupt: async () => {
        state.interrupted = true;
        return undefined;
      },
    });
  };
  return { queryFn, state };
}

function run(fake: ReturnType<typeof fakeQuery>, extra: Partial<Parameters<typeof runClaudeTurn>[0]> = {}) {
  const events: AgentEvent[] = [];
  const requestPermission = vi.fn(async () => ({ allow: true }));
  const handle = runClaudeTurn({
    workspace: ws,
    text: '你好',
    acquireEnv: () => ({ env: mcpEnv, release: () => {} }),
    emit: (e) => events.push(e),
    requestPermission,
    queryFn: fake.queryFn,
    ...extra,
  });
  return { handle, events, requestPermission };
}

// 权限用例的轮次必须保持活动，收尾时统一放开。
const suspended: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const settle of suspended.splice(0)) await settle();
});

describe('runClaudeTurn：调用参数', () => {
  it('按设计传入 cwd、设置来源、系统提示、MCP 与允许的工具', async () => {
    const fake = fakeQuery();
    await run(fake).handle.done;
    const o = fake.state.options!;
    expect(fake.state.prompt).toBe('你好');
    expect(o.cwd).toBe(ws.localDir);
    expect(o.settingSources).toEqual(['user', 'project', 'local']);
    expect(o.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' });
    expect((o.systemPrompt as { append: string }).append).toContain('my-server');
    const mcp = (o.mcpServers as Record<string, { command: string; env: Record<string, string> }>)['ssh-server']!;
    expect(mcp.command).toBe(process.execPath);
    expect(mcp.env.SSH_SERVER_INTERNAL_URL).toBe('http://127.0.0.1:1');
    expect(mcp.env.SSH_SERVER_SESSION_TOKEN).toBe('tok');
    expect(mcp.env.PATH ?? mcp.env.Path).toBeTruthy();
    expect(o.allowedTools).toEqual([
      'mcp__ssh-server__remote_exec',
      'mcp__ssh-server__remote_peek',
      'mcp__ssh-server__sync_now',
      'Read',
      'Glob',
      'Grep',
      'TodoWrite',
    ]);
    expect(o.includePartialMessages).toBe(true);
    expect('model' in o).toBe(false);
    expect('env' in o).toBe(false);
    expect('resume' in o).toBe(false);
    expect(o).not.toHaveProperty('effort');
    expect(o).not.toHaveProperty('thinking');
  });

  it('继续会话时传 resume，指定模型时传 model', async () => {
    const fake = fakeQuery();
    await run(fake, { sessionId: 's1', model: 'sonnet' }).handle.done;
    expect(fake.state.options).toMatchObject({ resume: 's1', model: 'sonnet' });
  });
});

describe('runClaudeTurn：事件', () => {
  it('转发映射后的事件', async () => {
    const fake = fakeQuery([
      {
        type: 'system',
        subtype: 'init',
        session_id: 's1',
        model: 'm',
        cwd: ws.localDir,
        parent_tool_use_id: null,
      },
      { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0.01, session_id: 's1' },
    ]);
    const { handle, events } = run(fake);
    await handle.done;
    expect(events.map((e) => e.type)).toEqual(['session', 'context', 'turn_end']);
    expect(events[1]).toEqual({ type: 'context', usage: null });
  });

  it('SDK 抛错时输出 error，并以出错的 turn_end 结束', async () => {
    const fake = fakeQuery([], new Error('API 错误'));
    const { handle, events } = run(fake);
    await handle.done;
    expect(events).toEqual([
      { type: 'error', message: 'API 错误' },
      { type: 'turn_end', isError: true },
    ]);
  });

  it('发送前中断不投递用户消息，本轮以错误收尾', async () => {
    const fake = fakeQuery([], undefined, [], true);
    const { handle } = run(fake);
    await handle.interrupt();
    await handle.done;
    expect(fake.state.prompt).toBeUndefined();
  });
});

describe('runClaudeTurn：权限', () => {
  // 长驻运行时里权限判定发生在轮次进行时，所以这里保持轮次活动再取 canUseTool。
  async function canUseTool(extra: Partial<Parameters<typeof runClaudeTurn>[0]> = {}) {
    const fake = fakeQuery([], undefined, [], true);
    const r = run(fake, extra);
    await vi.waitFor(() => expect(fake.state.options).toBeDefined());
    suspended.push(() => {
      fake.state.release?.();
      return r.handle.done;
    });
    return { fn: fake.state.options!.canUseTool as CanUseTool, ...r };
  }
  const signal = new AbortController().signal;

  it('本地文件夹内的编辑直接允许', async () => {
    const { fn, requestPermission } = await canUseTool();
    const r = await fn('Edit', { file_path: path.join(ws.localDir, 'src', 'a.py') }, { signal });
    expect(r.behavior).toBe('allow');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('本地文件夹外的编辑与 Bash 需要网页确认', async () => {
    const requestPermission = vi.fn(async () => ({ allow: false, message: '不允许' }));
    const { fn, events } = await canUseTool({ requestPermission });
    const outside = await fn('Write', { file_path: path.join(ws.localDir, '..', 'other', 'a.txt') }, { signal });
    expect(outside).toMatchObject({ behavior: 'deny', message: '不允许' });
    const bash = await fn('Bash', { command: 'ls' }, { signal });
    expect(bash.behavior).toBe('deny');
    expect(requestPermission).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(2);
  });

  it('网页同意时允许', async () => {
    const { fn, events } = await canUseTool();
    expect((await fn('Bash', { command: 'ls' }, { signal })).behavior).toBe('allow');
    const request = events.find((event) => event.type === 'permission_request');
    expect(events.at(-1)).toEqual({ type: 'permission_resolved', requestId: request?.requestId, decision: 'allowed' });
  });

  it('中断及时结束审批，迟到的批准不改变已拒绝结果', async () => {
    let answer!: (value: { allow: boolean }) => void;
    const { fn, events } = await canUseTool({
      requestPermission: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const controller = new AbortController();
    const pending = fn('Bash', { command: 'ls' }, { signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ behavior: 'deny', message: '本轮已中断' });
    answer({ allow: true });
    await Promise.resolve();
    expect(events.filter((event) => event.type === 'permission_resolved')).toMatchObject([{ decision: 'denied' }]);
    expect((await fn('Bash', { command: 'ls' }, { signal: controller.signal })).behavior).toBe('deny');
  });

  it('超时无答复时拒绝', async () => {
    const requestPermission = vi.fn(() => new Promise<{ allow: boolean }>(() => undefined));
    const { fn } = await canUseTool({ requestPermission });
    vi.useFakeTimers();
    const p = fn('Bash', { command: 'ls' }, { signal });
    await vi.advanceTimersByTimeAsync(PERMISSION_TIMEOUT_MS);
    expect((await p).behavior).toBe('deny');
  });
});

describe('Claude 推理强度', () => {
  const models: ModelInfo[] = [
    {
      value: 'supported-model',
      displayName: '支持模型',
      description: '',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'high'],
    },
    {
      value: 'no-effort',
      displayName: '不支持模型',
      description: '',
      supportsEffort: false,
      supportedEffortLevels: ['high'],
    },
  ];
  it('所选档位进入SDK effort且不改变thinking与权限，正常投递正文', async () => {
    const fake = fakeQuery([], undefined, models);
    await run(fake, { model: 'supported-model', reasoningEffort: 'high' }).handle.done;
    expect(fake.state.options).toMatchObject({ model: 'supported-model', effort: 'high' });
    expect(fake.state.options).not.toHaveProperty('thinking');
    expect(fake.state.options).not.toHaveProperty('permissionMode');
    expect(fake.state.prompt).toBe('你好');
  });
  it('SDK未知档位明确拒绝，不创建Query或丢弃参数后继续', () => {
    const fake = fakeQuery([], undefined, models);
    expect(() => run(fake, { model: 'supported-model', reasoningEffort: 'turbo' })).toThrow(/推理强度/);
    expect(fake.state.options).toBeUndefined();
  });
  it.each([
    { model: 'supported-model', reasoningEffort: 'max' },
    { model: 'no-effort', reasoningEffort: 'high' },
    { model: 'unknown-model', reasoningEffort: 'high' },
    { reasoningEffort: 'high' },
  ])('常用档位交给原生运行时，不以目录元数据阻止发送：%j', async (input) => {
    const fake = fakeQuery([], undefined, models);
    await run(fake, input).handle.done;
    expect(fake.state.options).toMatchObject({ effort: input.reasoningEffort });
    expect(fake.state.prompt).toBe('你好');
  });

  it.each(['low', 'medium', 'high', 'xhigh', 'max'])('默认模型支持直接传递%s，不要求读取模型目录', async (effort) => {
    const fake = fakeQuery([], undefined, new Error('模型目录读取失败'));
    await run(fake, { reasoningEffort: effort }).handle.done;
    expect(fake.state.options).toMatchObject({ effort });
    expect(fake.state.options).not.toHaveProperty('model');
    expect(fake.state.prompt).toBe('你好');
  });

  it('原生拒绝强度时保留原始失败，不降级参数重试', async () => {
    const fake = fakeQuery([], new Error('模型不支持 high'), new Error('模型目录读取失败'));
    const { handle, events } = run(fake, { model: 'custom-model', reasoningEffort: 'high' });
    await handle.done;
    expect(fake.state.prompt).toBe('你好');
    expect(fake.state.options).toMatchObject({ model: 'custom-model', effort: 'high' });
    expect(events).toContainEqual({ type: 'error', message: '模型不支持 high' });
    expect(events.at(-1)).toEqual({ type: 'turn_end', isError: true });
  });
});
