import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, Workspace } from '@ssh-server/shared';
import { PERMISSION_TIMEOUT_MS, runClaudeTurn, type QueryFn } from './claude-adapter';

const ws: Workspace = {
  id: 'w1',
  name: 'demo',
  localDir: 'E:\\work\\demo',
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
};
const mcpEnv = { SSH_SERVER_INTERNAL_URL: 'http://127.0.0.1:1', SSH_SERVER_SESSION_TOKEN: 'tok' };

type CanUseTool = (
  name: string,
  input: Record<string, unknown>,
  o: { signal: AbortSignal },
) => Promise<{ behavior: string; message?: string }>;

function fakeQuery(messages: unknown[] = [], fail?: Error) {
  const state: { options?: Record<string, unknown>; prompt?: unknown; interrupted: boolean } = { interrupted: false };
  const queryFn: QueryFn = ({ prompt, options }) => {
    state.prompt = prompt;
    state.options = options;
    async function* gen() {
      for (const m of messages) yield m;
      if (fail) throw fail;
    }
    return Object.assign(gen(), {
      interrupt: async () => {
        state.interrupted = true;
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
    mcpEnv,
    emit: (e) => events.push(e),
    requestPermission,
    queryFn: fake.queryFn,
    ...extra,
  });
  return { handle, events, requestPermission };
}

afterEach(() => {
  vi.useRealTimers();
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
        cwd: 'E:\\work\\demo',
        parent_tool_use_id: null,
      },
      { type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0.01, session_id: 's1' },
    ]);
    const { handle, events } = run(fake);
    await handle.done;
    expect(events.map((e) => e.type)).toEqual(['session', 'turn_end']);
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

  it('interrupt 调用 query 的 interrupt', async () => {
    const fake = fakeQuery();
    const { handle } = run(fake);
    await handle.interrupt();
    expect(fake.state.interrupted).toBe(true);
    await handle.done;
  });
});

describe('runClaudeTurn：权限', () => {
  async function canUseTool(extra: Partial<Parameters<typeof runClaudeTurn>[0]> = {}) {
    const fake = fakeQuery();
    const r = run(fake, extra);
    await r.handle.done;
    return { fn: fake.state.options!.canUseTool as CanUseTool, ...r };
  }
  const signal = new AbortController().signal;

  it('本地文件夹内的编辑直接允许', async () => {
    const { fn, requestPermission } = await canUseTool();
    const r = await fn('Edit', { file_path: 'E:\\work\\demo\\src\\a.py' }, { signal });
    expect(r.behavior).toBe('allow');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('本地文件夹外的编辑与 Bash 需要网页确认', async () => {
    const requestPermission = vi.fn(async () => ({ allow: false, message: '不允许' }));
    const { fn, events } = await canUseTool({ requestPermission });
    const outside = await fn('Write', { file_path: 'E:\\other\\a.txt' }, { signal });
    expect(outside).toMatchObject({ behavior: 'deny', message: '不允许' });
    const bash = await fn('Bash', { command: 'ls' }, { signal });
    expect(bash.behavior).toBe('deny');
    expect(requestPermission).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(2);
  });

  it('网页同意时允许', async () => {
    const { fn } = await canUseTool();
    expect((await fn('Bash', { command: 'ls' }, { signal })).behavior).toBe('allow');
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
