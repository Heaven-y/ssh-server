import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@agentdeck/shared/conversation';
import { createAntigravityRunner, type AntigravityProcess } from '../../../src/agents/antigravity/adapter';

const cwd = path.join(tmpdir(), 'agentdeck-agy-fixture');
afterEach(() => vi.useRealTimers());
async function setup(
  sessionId?: string,
  defaultModel: () => Promise<string | undefined> = async () => undefined,
  model?: string,
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
    f.child.stderr.write('tool run_command soft-denied; token=synthetic-secret\n');
    f.finish();
    await f.handle.done;
    expect(f.events.filter((event) => event.type === 'tool_call')).toHaveLength(1);
    expect(f.events).toContainEqual({ type: 'tool_result', id: 'agy-step-3', output: '示例输出', isError: false });
    expect(f.events.some((event) => event.type === 'error' && event.message.includes('权限'))).toBe(true);
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
