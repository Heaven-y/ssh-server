import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@agentdeck/shared/conversation';
import { createAntigravityRunner, type AntigravityProcess } from '../../../src/agents/antigravity/adapter';
import type { AntigravitySessionManagement } from '../../../src/agents/antigravity/session-management-types';

const cwd = path.join(tmpdir(), 'agentdeck-agy-completion');
const previousError = 'agent executor error: generating and executing: Error 524, Status: 524 unknown';
afterEach(() => vi.useRealTimers());

async function resumedTurn(resume = true, readTrajectory?: AntigravitySessionManagement['readTrajectory']) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  const events: AgentEvent[] = [];
  const runner = createAntigravityRunner({
    launch: () => child as unknown as AntigravityProcess,
    defaultModel: async () => undefined,
    readTrajectory,
  });
  const handle = runner({
    workspace: { id: 'p', name: '项目', dir: cwd },
    sessionId: resume ? 'native-resumed' : undefined,
    text: '继续示例',
    emit: (event) => events.push(event),
    requestPermission: async () => ({ allow: false }),
  });
  await Promise.resolve();
  const output = (value: unknown) => child.stdout.write(`${JSON.stringify(value)}\n`);
  output({ event: 'init', conversation_id: 'native-resumed', init: { cwd } });
  const step = (index: number, type: string, state = 'DONE', extra?: Record<string, unknown>) =>
    output({
      event: 'step_update',
      step_update: {
        conversation_id: 'native-resumed',
        step_index: index,
        step_type: type,
        state,
        ...extra,
      },
    });
  const result = (changes: Record<string, unknown> = {}) =>
    output({
      event: 'result',
      result: {
        conversation_id: 'native-resumed',
        status: 'ERROR',
        error: previousError,
        response: '本轮完成。\n',
        num_turns: 2,
        ...changes,
      },
    });
  return { child, events, handle, step, result, runner };
}

it('原生续接成功但累计 result 保留旧失败时，等待自然退出后按本轮完成', async () => {
  const f = await resumedTurn();
  f.step(4, 'user_input');
  f.step(5, 'agent_response', 'DONE', { text_delta: '准备执行。' });
  f.step(6, 'tool');
  f.step(7, 'agent_response', 'ACTIVE', { text_delta: '本轮完成。' });
  // 工具的迟到更新不能覆盖更高索引的最终公开答复。
  f.step(6, 'tool');
  f.step(7, 'agent_response', 'DONE', { text_delta: '\n' });
  f.result();
  expect(f.events.some((event) => event.type === 'error' || event.type === 'turn_end')).toBe(false);
  f.child.emit('close', 0);
  await f.handle.done;
  expect(f.events.filter((event) => event.type === 'error')).toEqual([]);
  expect(f.events.at(-1)).toEqual({ type: 'turn_end', isError: false });
});

function completedTrajectory() {
  const step = (type: string, extra?: Record<string, unknown>) => ({
    type: `CORTEX_STEP_TYPE_${type}`,
    status: 'CORTEX_STEP_STATUS_DONE',
    ...extra,
  });
  return {
    cascadeId: 'native-resumed',
    steps: [
      step('USER_INPUT'),
      step('PLANNER_RESPONSE'),
      step('RUN_COMMAND'),
      step('ERROR_MESSAGE'),
      step('USER_INPUT'),
      step('VIEW_FILE'),
      step('PLANNER_RESPONSE', { plannerResponse: { response: '本轮已完成。' } }),
    ],
  };
}

it('直播缺少最终文本增量时，只读复核本轮原生终态后移除累计旧524', async () => {
  let resolve!: (value: { trajectory: ReturnType<typeof completedTrajectory> }) => void;
  const read = vi.fn(
    () =>
      new Promise<{ trajectory: ReturnType<typeof completedTrajectory> }>((done) => {
        resolve = done;
      }),
  );
  const f = await resumedTurn(true, read);
  f.step(4, 'user_input');
  f.step(5, 'tool');
  f.step(6, 'agent_response');
  f.result();
  f.child.emit('close', 0);
  await Promise.resolve();
  expect(f.events.some((event) => event.type === 'error' || event.type === 'turn_end')).toBe(false);
  expect(read).toHaveBeenCalledWith('native-resumed', cwd, expect.any(AbortSignal));
  resolve({ trajectory: completedTrajectory() });
  await f.handle.done;
  expect(f.events.filter((event) => event.type === 'error')).toEqual([]);
  expect(f.events.at(-1)).toEqual({ type: 'turn_end', isError: false });
});

it.each(['current-error', 'wrong-session', 'wrong-input', 'later-input', 'stale-final', 'denied', 'read-failed'])(
  '原生复核遇到%s时仍保留失败，不能用另一个成功回合覆盖',
  async (scenario) => {
    const trajectory = completedTrajectory();
    if (scenario === 'current-error') trajectory.steps[5]!.type = 'CORTEX_STEP_TYPE_ERROR_MESSAGE';
    if (scenario === 'wrong-session') trajectory.cascadeId = 'other-session';
    if (scenario === 'wrong-input') trajectory.steps[4]!.type = 'CORTEX_STEP_TYPE_PLANNER_RESPONSE';
    if (scenario === 'later-input') trajectory.steps[5]!.type = 'CORTEX_STEP_TYPE_USER_INPUT';
    if (scenario === 'stale-final') trajectory.steps.splice(5);
    if (scenario === 'denied') Object.assign(trajectory.steps[5]!, { runCommand: { userRejected: true } });
    const read = async () => {
      if (scenario === 'read-failed') throw new Error('private-native-failure');
      return { trajectory };
    };
    const f = await resumedTurn(true, read);
    f.step(4, 'user_input');
    f.step(6, 'agent_response');
    f.result();
    f.child.emit('close', 0);
    await f.handle.done;
    expect(f.events.at(-1)).toEqual({ type: 'turn_end', isError: true });
    expect(f.events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', message: expect.stringContaining('524') },
    ]);
    expect(JSON.stringify(f.events)).not.toContain('private-native-failure');
  },
);

it('直播中的工具过渡错误由原生同一步最终成功证据复核，不能永久污染终态', async () => {
  const f = await resumedTurn(true, async () => ({ trajectory: completedTrajectory() }));
  f.step(4, 'user_input');
  f.step(5, 'tool', 'ACTIVE', { tool_info: { error: { type: 'TOOL_ERROR', message: '示例过渡状态' } } });
  f.step(5, 'tool', 'DONE');
  f.step(6, 'agent_response', 'DONE', { text_delta: '本轮已完成。' });
  f.result();
  f.child.emit('close', 0);
  await f.handle.done;
  expect(f.events.filter((event) => event.type === 'error')).toEqual([]);
  expect(f.events.at(-1)).toEqual({ type: 'turn_end', isError: false });
});

it.each(['interrupt', 'dispose'] as const)('进程退出后%s仍能取消终态复核并释放占用', async (action) => {
  let reviewSignal: AbortSignal | undefined;
  const read = vi.fn((_id: string, _dir: string, signal?: AbortSignal) => {
    reviewSignal = signal;
    return new Promise<{ trajectory: Record<string, unknown> }>(() => {});
  });
  const f = await resumedTurn(true, read);
  f.step(4, 'user_input');
  f.step(6, 'agent_response');
  f.result();
  f.child.emit('close', 0);
  await Promise.resolve();
  if (action === 'interrupt') await f.handle.interrupt();
  else await f.runner.dispose?.();
  await f.handle.done;
  expect(reviewSignal?.aborted).toBe(true);
  expect(f.events.filter((event) => event.type === 'turn_end')).toEqual([{ type: 'turn_end', isError: true }]);
});

it.each(['stderr', 'current-error', 'cancelled', 'multiple-input', 'denied', 'exit', 'cleanup'])(
  '%s 已确认失败或边界不可信时不发起原生复核',
  async (scenario) => {
    if (scenario === 'cleanup') vi.useFakeTimers();
    const read = vi.fn(async () => ({ trajectory: completedTrajectory() }));
    const f = await resumedTurn(true, read);
    f.step(4, 'user_input');
    if (scenario === 'stderr') f.child.stderr.write('error: Error 524\n');
    if (scenario === 'current-error') f.step(5, 'error_message');
    if (scenario === 'cancelled') f.step(5, 'tool', 'CANCELLED');
    if (scenario === 'multiple-input') f.step(5, 'user_input');
    f.step(6, 'agent_response');
    f.result(scenario === 'denied' ? { denied_actions: [{ action: 'command' }] } : {});
    if (scenario === 'cleanup') await vi.advanceTimersByTimeAsync(2100);
    f.child.emit('close', scenario === 'exit' ? 3 : 0);
    await f.handle.done;
    expect(read).not.toHaveBeenCalled();
    expect(f.events.at(-1)).toEqual({ type: 'turn_end', isError: true });
  },
);

it('原生复核超过预算时结束等待并保留失败', async () => {
  let reviewSignal: AbortSignal | undefined;
  const f = await resumedTurn(true, (_id, _dir, signal) => {
    reviewSignal = signal;
    return new Promise(() => {});
  });
  f.step(4, 'user_input');
  f.step(6, 'agent_response');
  f.result();
  f.child.emit('close', 0);
  await f.handle.done;
  expect(reviewSignal?.aborted).toBe(true);
  expect(f.events.at(-1)).toEqual({ type: 'turn_end', isError: true });
}, 7000);

it.each(['ERROR', 'DONE'])('本轮工具失败后正常答复不沿用历史524，工具自身仍显示失败：%s', async (state) => {
  const f = await resumedTurn();
  f.step(4, 'user_input');
  f.step(5, 'tool', state, {
    tool_name: 'view_file',
    tool_info: { name: 'view_file', error: { type: 'TOOL_ERROR', message: '示例文件不存在' } },
  });
  f.step(6, 'agent_response', 'DONE', { text_delta: '已说明文件读取结果。' });
  f.result();
  f.child.emit('close', 0);
  await f.handle.done;
  expect(f.events).toContainEqual(
    expect.objectContaining({ type: 'tool_result', isError: true, output: '示例文件不存在' }),
  );
  expect(f.events.filter((event) => event.type === 'error')).toEqual([]);
  expect(f.events.at(-1)).toEqual({ type: 'turn_end', isError: false });
});

it('工具自己的 HTTP 500 不误报模型服务失败，模型继续答复后仍可纠正累计旧错误', async () => {
  const f = await resumedTurn();
  f.step(4, 'user_input');
  f.step(5, 'tool', 'ERROR', {
    tool_name: 'read_url',
    tool_info: { name: 'read_url', error: { type: 'TOOL_ERROR', message: 'HTTP 500: example tool service failed' } },
  });
  f.step(6, 'agent_response', 'DONE', { text_delta: '已说明工具服务不可用。' });
  f.result();
  f.child.emit('close', 0);
  await f.handle.done;
  expect(f.events).toContainEqual(
    expect.objectContaining({ type: 'tool_result', isError: true, output: 'HTTP 500: example tool service failed' }),
  );
  expect(f.events.filter((event) => event.type === 'error')).toEqual([]);
  expect(f.events.at(-1)).toEqual({ type: 'turn_end', isError: false });
});

type Step = [number, string, string?, Record<string, unknown>?];
const completedSteps: Step[] = [
  [4, 'user_input'],
  [6, 'agent_response', 'DONE', { text_delta: '本轮答复。' }],
];
type IncompleteEvidence = {
  resume?: boolean;
  steps?: Step[];
  stderr?: string;
  result?: Record<string, unknown>;
  exit?: number;
};
const incompleteCases: [string, IncompleteEvidence][] = [
  ['非零退出', { exit: 3 }],
  ['首轮未续接', { resume: false, steps: [[0, 'user_input'], completedSteps[1]!] }],
  ['缺少本轮输入', { steps: [completedSteps[1]!] }],
  ['输入边界前已收到高索引错误', { steps: [[7, 'error_message'], ...completedSteps] }],
  ['缺少最终公开文本', { steps: [completedSteps[0]!, [6, 'agent_response']] }],
  ['最终答复未结束', { steps: [completedSteps[0]!, [6, 'agent_response', 'ACTIVE', { text_delta: '本轮答复。' }]] }],
  ['答复后仍有工具', { steps: [...completedSteps, [7, 'tool']] }],
  ['本轮有错误步骤', { steps: [completedSteps[0]!, [5, 'error_message'], completedSteps[1]!] }],
  ['错误后重复输入事件', { steps: [completedSteps[0]!, [5, 'error_message'], completedSteps[0]!, completedSteps[1]!] }],
  ['本轮步骤已取消', { steps: [completedSteps[0]!, [5, 'tool', 'CANCELLED'], completedSteps[1]!] }],
  [
    'DONE 工具仍有原生错误',
    {
      steps: [
        completedSteps[0]!,
        [
          5,
          'tool',
          'DONE',
          { tool_info: { name: 'run_command', error: { type: 'TOOL_ERROR', message: 'Error 524' } } },
        ],
        completedSteps[1]!,
      ],
    },
  ],
  ['原生 stderr 失败', { stderr: 'error: synthetic-native-failure\n' }],
  ['未知结果状态', { result: { status: 'UNKNOWN' } }],
  ['结果缺少会话身份', { result: { conversation_id: undefined } }],
  ['缺少结果答复', { result: { response: '' } }],
  ['结果仍含被拒绝的操作', { result: { denied_actions: [{ action: 'command', display_name: 'RunCommand' }] } }],
];

it.each(incompleteCases)('累计旧失败遇到%s时仍保留失败', async (_scenario, input) => {
  const f = await resumedTurn(input.resume);
  for (const step of input.steps ?? completedSteps) f.step(...step);
  if (input.stderr) f.child.stderr.write(input.stderr);
  f.result(input.result);
  f.child.emit('close', input.exit ?? 0);
  await f.handle.done;
  expect(f.events.at(-1)).toEqual({ type: 'turn_end', isError: true });
  expect(f.events.some((event) => event.type === 'error')).toBe(true);
  expect(JSON.stringify(f.events)).not.toContain('synthetic-native-failure');
});

it('自动清理后的退出不能代替原生自然成功证据', async () => {
  vi.useFakeTimers();
  const f = await resumedTurn();
  f.step(4, 'user_input');
  f.step(6, 'agent_response', 'DONE', { text_delta: '本轮答复。' });
  f.result();
  await vi.advanceTimersByTimeAsync(2100);
  f.child.emit('close', 0);
  await f.handle.done;
  expect(f.events.at(-1)).toEqual({ type: 'turn_end', isError: true });
});

it('工具成功后模型服务 HTTP 524 的真实失败给出一次脱敏原因', async () => {
  const f = await resumedTurn();
  f.step(4, 'user_input');
  f.step(5, 'tool');
  f.step(6, 'error_message');
  const error = `${previousError}; token=synthetic-secret; https://private.invalid/path`;
  f.result({ error, response: '' });
  f.child.stderr.write(`error: ${error}\nAGY_ERROR: ${JSON.stringify({ short_error: error })}\n`);
  f.child.emit('close', 3);
  await f.handle.done;
  expect(f.events.filter((event) => event.type === 'error')).toEqual([
    { type: 'error', message: expect.stringContaining('524') },
  ]);
  expect(f.events.at(-1)).toEqual({ type: 'turn_end', isError: true });
  expect(JSON.stringify(f.events)).not.toMatch(/synthetic-secret|private\.invalid/);
});
