import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PermissionSelection, AgentEvent } from '@agentdeck/shared/conversation';
import { createAntigravityRunner, type AntigravityProcess } from '../../../src/agents/antigravity/adapter';

const cwd = path.join(tmpdir(), 'agentdeck-agy-fixture');
afterEach(() => vi.useRealTimers());
async function setup(
  sessionId?: string,
  defaultModel: () => Promise<string | undefined> = async () => undefined,
  model?: string,
  permission?: PermissionSelection,
) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  const launch = vi.fn((_input: { cwd: string; args: string[] }) => child as unknown as AntigravityProcess);
  const events: AgentEvent[] = [];
  const runner = createAntigravityRunner({ launch, defaultModel });
  const handle = runner({
    workspace: { id: 'p', name: '项目', dir: cwd },
    sessionId,
    model,
    permission,
    text: '只作为测试输入',
    emit: (event) => events.push(event),
    requestPermission: async () => ({ allow: false }),
  });
  const output = (value: unknown) => child.stdout.write(`${JSON.stringify(value)}\n`);
  const init = (id = sessionId ?? 'native-1') => output({ event: 'init', conversation_id: id, init: { cwd } });
  const finish = (id = sessionId ?? 'native-1') => {
    output({ event: 'result', result: { conversation_id: id, status: 'SUCCESS', response: '你好' } });
    child.emit('close', 0);
  };
  await Promise.resolve();
  return { child, launch, events, runner, handle, output, init, finish };
}

describe('Antigravity 原生对话运行器', () => {
  it('普通 stderr 进度和包含 permission 的日志不会把成功回合标成诊断错误', async () => {
    const f = await setup();
    f.init();
    f.child.stderr.write('Loading settings\ninfo: permission mode: request-review\nwarning: checking for updates\n');
    f.finish();
    await f.handle.done;
    expect(f.events.filter((event) => event.type === 'error')).toEqual([]);
    expect(f.events.at(-1)).toEqual({ type: 'turn_end', isError: false });
  });

  it('auto 的原生回退提示只显示一次且不改参数或成功结果', async () => {
    const f = await setup(undefined, async () => undefined, undefined, { agent: 'antigravity', mode: 'auto' });
    const warning =
      'warning: --mode auto is not available because the terminal sandbox is not available on this host; continuing in the default mode.\n';
    f.child.stderr.write(warning + warning);
    f.init();
    f.finish();
    await f.handle.done;
    expect(f.launch.mock.calls[0]?.[0].args.slice(-2)).toEqual(['--mode', 'auto']);
    expect(f.events.filter((event) => event.type === 'error')).toEqual([]);
    expect(f.events.filter((event) => event.type === 'activity')).toEqual([
      expect.objectContaining({
        name: '权限模式已回退',
        status: 'completed',
        output: expect.stringContaining('终端沙箱'),
      }),
    ]);
    expect(f.events.at(-1)).toEqual({ type: 'turn_end', isError: false });
  });

  it('auto 不受支持但未报告回退时显示具体失败，不声称已经切换模式', async () => {
    const f = await setup();
    f.output({ event: 'result', result: { status: 'ERROR', error: 'auto mode is not available for this account' } });
    f.child.emit('close', 1);
    await f.handle.done;
    expect(f.events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', message: expect.stringContaining('auto') },
    ]);
    expect(JSON.stringify(f.events)).not.toContain('已回退');
  });

  it.each([
    ['result-first', 'Error 401, Message: invalid API key, Status: UNAUTHENTICATED', '认证'],
    ['stderr-first', 'Error 503, Message: model unavailable, Status: UNAVAILABLE', '503'],
  ])('%s 的具体失败只报告一次且不会被泛化诊断覆盖', async (order, nativeError, expected) => {
    const f = await setup();
    f.init();
    const detail = `${nativeError}; token=synthetic-secret; https://private.invalid/path`;
    const result = () =>
      f.output({ event: 'result', result: { conversation_id: 'native-1', status: 'ERROR', error: detail } });
    const stderr = () =>
      f.child.stderr.write(`error: ${detail}\nAGY_ERROR: ${JSON.stringify({ short_error: detail })}\n`);
    if (order === 'result-first') {
      result();
      stderr();
    } else {
      stderr();
      result();
    }
    f.child.emit('close', 3);
    await f.handle.done;
    expect(f.events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', message: expect.stringContaining(expected) },
    ]);
    expect(f.events.at(-1)).toMatchObject({ type: 'turn_end', isError: true });
    expect(JSON.stringify(f.events)).not.toMatch(/synthetic-secret|private\.invalid/);
  });

  it('认证失败在 result 前退出时保留原因，不再追加缺失结果的泛化错误', async () => {
    const f = await setup();
    f.child.stderr.write('error: authentication required; token=synthetic-secret');
    f.child.emit('close', 1);
    await f.handle.done;
    expect(f.events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', message: expect.stringContaining('认证') },
    ]);
    expect(f.events.at(-1)).toMatchObject({ type: 'turn_end', isError: true });
    expect(JSON.stringify(f.events)).not.toContain('synthetic-secret');
  });

  it('未知失败等待 stderr 排空后仅给出一次安全兜底', async () => {
    const f = await setup();
    f.init();
    f.output({ event: 'result', result: { conversation_id: 'native-1', status: 'ERROR', error: 'synthetic-secret' } });
    expect(f.events.some((event) => event.type === 'error')).toBe(false);
    f.child.stderr.write('error: synthetic-secret\n');
    f.child.emit('close', 3);
    await f.handle.done;
    expect(f.events.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(JSON.stringify(f.events)).not.toContain('synthetic-secret');
  });

  it.each([true, false])('无 stderr 的 denied_actions 给出脱敏权限提示（有工具错误=%s）', async (toolError) => {
    const f = await setup();
    f.init();
    if (toolError)
      f.output({
        event: 'step_update',
        step_update: {
          conversation_id: 'native-1',
          step_index: 2,
          state: 'ERROR',
          step_type: 'tool',
          tool_name: 'run_command',
          tool_info: {
            name: 'run_command',
            parameters: { CommandLine: 'echo demo' },
            error: {
              type: 'TOOL_ERROR',
              message: 'permission check failed: user denied permission to run command; token=synthetic-secret',
            },
          },
        },
      });
    f.output({
      event: 'result',
      result: {
        conversation_id: 'native-1',
        status: 'SUCCESS',
        denied_actions: [{ action: 'command', display_name: 'RunCommand' }],
      },
    });
    f.child.emit('close', 0);
    await f.handle.done;
    expect(f.events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', message: expect.stringContaining('权限') },
    ]);
    if (toolError)
      expect(f.events).toContainEqual(
        expect.objectContaining({ type: 'tool_result', isError: true, output: expect.stringContaining('权限') }),
      );
    expect(f.events.some((event) => event.type === 'permission_request')).toBe(false);
    expect(f.events.at(-1)).toEqual({ type: 'turn_end', isError: false });
    expect(JSON.stringify(f.events)).not.toContain('synthetic-secret');
  });

  it('文件系统 permission denied 不冒充工具审批被软拒', async () => {
    const f = await setup();
    f.init();
    f.output({
      event: 'step_update',
      step_update: {
        conversation_id: 'native-1',
        step_index: 2,
        state: 'ERROR',
        step_type: 'tool',
        tool_name: 'view_file',
        tool_info: {
          name: 'view_file',
          error: { type: 'TOOL_ERROR', message: 'EACCES: permission denied opening demo.txt' },
        },
      },
    });
    f.finish();
    await f.handle.done;
    expect(f.events.filter((event) => event.type === 'error')).toEqual([]);
    expect(f.events).toContainEqual({
      type: 'tool_result',
      id: 'agy-step-2',
      isError: true,
      output: 'EACCES: permission denied opening demo.txt',
    });
  });

  it('选中技能通过原生斜杠调用发送，准备阶段取消不会迟到启动对话', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    });
    const launch = vi.fn(() => child as unknown as AntigravityProcess);
    const runner = createAntigravityRunner({
      launch,
      defaultModel: async () => undefined,
      invocationText: async () => '/review 检查示例',
    });
    const input = {
      workspace: { id: 'p', name: '项目', dir: cwd },
      text: '检查示例',
      invocation: { kind: 'skill' as const, name: 'review' },
      emit: () => {},
      requestPermission: async () => ({ allow: false }),
    };
    const turn = runner(input);
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());
    expect(JSON.parse(String(child.stdin.read()))).toEqual({ event: 'user', message: { content: '/review 检查示例' } });
    child.emit('close', 0);
    await turn.done;
    launch.mockClear();
    let resolve!: (value: string) => void;
    let preparationSignal: AbortSignal | undefined;
    const waiting = createAntigravityRunner({
      launch,
      defaultModel: async () => undefined,
      invocationText: (_input, signal) => {
        preparationSignal = signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    const stopped = waiting(input);
    await stopped.interrupt();
    expect(preparationSignal?.aborted).toBe(true);
    resolve('/review 检查示例');
    await Promise.resolve();
    expect(launch).not.toHaveBeenCalled();
  });
  it('没有显式选择时使用已核验自定义默认键，显式模型不被覆盖', async () => {
    const defaultModel = vi.fn(async () => 'custom-key');
    const first = await setup(undefined, defaultModel);
    expect(first.launch.mock.calls[0]?.[0]?.args).toContain('custom-key');
    first.init();
    first.finish();
    await first.handle.done;
    defaultModel.mockClear();
    const second = await setup(undefined, defaultModel, 'explicit-model');
    expect(second.launch.mock.calls[0]?.[0]?.args).toContain('explicit-model');
    expect(defaultModel).not.toHaveBeenCalled();
    second.init();
    second.finish();
    await second.handle.done;
  });

  it('默认模型读取期间取消不会迟到启动进程，准备错误也正常结束', async () => {
    let resolve!: (value: string | undefined) => void;
    const f = await setup(
      undefined,
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await f.handle.interrupt();
    resolve('late-model');
    await Promise.resolve();
    expect(f.launch).not.toHaveBeenCalled();
    expect(f.events.at(-1)).toMatchObject({ type: 'turn_end', isError: true });
    const failed = await setup(undefined, async () => {
      throw new Error('private-config-error');
    });
    await failed.handle.done;
    expect(failed.launch).not.toHaveBeenCalled();
    expect(failed.events.at(-1)).toMatchObject({ type: 'turn_end', isError: true });
    expect(JSON.stringify(failed.events)).not.toContain('private-config-error');
  });
  it.each([true, false])('结果后清理等待保留占用；清理信号接受=%s', async (accepted) => {
    vi.useFakeTimers();
    const f = await setup();
    f.init();
    f.child.kill.mockReturnValue(accepted);
    f.output({ event: 'result', result: { conversation_id: 'native-1', status: 'SUCCESS', response: '已输出' } });
    let finished = false;
    void f.handle.done.then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(4_100);
    expect(finished).toBe(false);
    expect(f.events.some((event) => event.type === 'error')).toBe(false);
    expect(f.child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(f.events.some((event) => event.type === 'turn_end')).toBe(false);
    f.child.emit('close', null);
    await f.handle.done;
    expect(f.events.at(-1)).toMatchObject({ type: 'turn_end', isError: !accepted });
  });

  it('结果后用户主动中断仍标失败，不能与自动清理混淆', async () => {
    vi.useFakeTimers();
    const f = await setup();
    f.init();
    f.output({ event: 'result', result: { conversation_id: 'native-1', status: 'SUCCESS', response: '已输出' } });
    await vi.advanceTimersByTimeAsync(2100);
    const stopping = f.handle.interrupt();
    f.child.emit('close', null);
    await stopping;
    expect(f.events.at(-1)).toMatchObject({ type: 'turn_end', isError: true });
  });
  it('prompt只写stdin，默认不覆盖模型强度或原生权限', async () => {
    const f = await setup();
    const input = String(f.child.stdin.read());
    expect(JSON.parse(input)).toEqual({ event: 'user', message: { content: '只作为测试输入' } });
    expect(f.launch.mock.calls[0]?.[0]).toMatchObject({
      cwd,
      args: ['--input-format', 'stream-json', '--output-format', 'stream-json'],
    });
    f.init();
    f.finish();
    await f.handle.done;
    expect(f.events).toContainEqual({ type: 'session', sessionId: 'native-1', agent: 'antigravity', cwd, model: '' });
    expect(f.events.filter((event) => event.type === 'turn_end')).toEqual([{ type: 'turn_end', isError: false }]);
  });

  it('续接只传原生id，分块UTF8和NDJSON文本不重复渲染结果全文', async () => {
    const f = await setup('native-2');
    expect(f.launch.mock.calls[0]?.[0]?.args).toContain('native-2');
    f.init();
    const line = Buffer.from(
      JSON.stringify({
        event: 'step_update',
        step_update: {
          conversation_id: 'native-2',
          step_index: 1,
          step_type: 'agent_response',
          state: 'ACTIVE',
          text_delta: '你好',
        },
      }) + '\n',
    );
    const split = line.indexOf(Buffer.from('好')) + 1;
    f.child.stdout.write(line.subarray(0, split));
    f.child.stdout.write(line.subarray(split));
    f.finish();
    await f.handle.done;
    expect(f.events.filter((event) => event.type === 'text')).toEqual([{ type: 'text', delta: '你好' }]);
  });

  it('工具按step身份去重，软拒有提示且不会伪造交互审批', async () => {
    const f = await setup();
    f.init();
    const step = {
      conversation_id: 'native-1',
      step_index: 3,
      step_type: 'tool',
      tool_name: 'run_command',
      tool_info: { name: 'run_command', parameters: { command: 'demo' }, output: '示例输出' },
    };
    f.output({ event: 'step_update', step_update: { ...step, state: 'ACTIVE' } });
    f.output({ event: 'step_update', step_update: { ...step, state: 'DONE' } });
    f.child.stderr.write('tool required permission; soft-denied; token=synthetic-secret\n');
    f.finish();
    await f.handle.done;
    expect(f.events.filter((event) => event.type === 'tool_call')).toHaveLength(1);
    expect(f.events).toContainEqual({ type: 'tool_result', id: 'agy-step-3', output: '示例输出', isError: false });
    expect(f.events.some((event) => event.type === 'error' && event.message.includes('权限'))).toBe(true);
    expect(f.events.some((event) => event.type === 'error' && event.message.includes('required'))).toBe(false);
    expect(f.events.some((event) => event.type === 'permission_request')).toBe(false);
    expect(JSON.stringify(f.events)).not.toContain('synthetic-secret');
  });

  it('中断结束子进程并只结束一次，退出后的迟到输出不显示', async () => {
    const f = await setup();
    f.init();
    const stopping = f.handle.interrupt();
    expect(f.child.kill).toHaveBeenCalled();
    f.child.emit('close', null);
    await stopping;
    await f.handle.done;
    f.output({ event: 'result', result: { conversation_id: 'native-1', status: 'SUCCESS', response: '迟到' } });
    expect(f.events.filter((event) => event.type === 'turn_end')).toEqual([{ type: 'turn_end', isError: true }]);
    expect(JSON.stringify(f.events)).not.toContain('迟到');
  });

  it.each(['identity', 'malformed', 'truncated', 'spawn'])('%s异常不会成功收尾或泄漏原始诊断', async (kind) => {
    const f = await setup('expected');
    if (kind === 'identity') f.init('different');
    else if (kind === 'malformed') f.child.stdout.write('not-json\n');
    else if (kind === 'spawn') f.child.emit('error', new Error('synthetic-secret'));
    else f.init();
    f.child.emit('close', 1);
    await f.handle.done;
    expect(f.events.at(-1)).toMatchObject({ type: 'turn_end', isError: true });
    expect(f.events.some((event) => event.type === 'error')).toBe(true);
    expect(JSON.stringify(f.events)).not.toContain('synthetic-secret');
  });

  it('单行无换行超限立即中断，dispose清理仍在运行的进程', async () => {
    const f = await setup();
    f.child.stdout.write('x'.repeat(1_048_577));
    expect(f.child.kill).toHaveBeenCalled();
    f.child.emit('close', null);
    await f.runner.dispose?.();
    await f.handle.done;
    expect(f.events.at(-1)).toMatchObject({ type: 'turn_end', isError: true });
  });
});

it.each(['accept-edits', 'auto', 'plan', 'bypass'] as const)(
  'Antigravity %s 交给原生模式，不伪造审批',
  async (mode) => {
    const f = await setup(undefined, async () => undefined, undefined, { agent: 'antigravity', mode });
    const args = f.launch.mock.calls[0]![0].args;
    if (mode === 'bypass') expect(args).toContain('--dangerously-skip-permissions');
    else expect(args.slice(-2)).toEqual(['--mode', mode]);
    f.init();
    f.finish();
    await f.handle.done;
  },
);
