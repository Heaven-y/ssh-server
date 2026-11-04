import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ServerMessage, Workspace } from '@agentdeck/shared';
import type { AgentTurnInput } from '../../src/agents/types';
import { SessionError } from '../../src/chat/sessions';
import { TurnManager, type Socket, type TurnManagerDeps } from '../../src/chat/turn-manager';

const ws: Workspace = {
  id: 'w1',
  name: 'demo',
  dir: path.join(os.tmpdir(), 'agentdeck-fixture', 'demo'),
  server: 'my-server',
  remoteDir: '~/projects/demo',
};

function fakeSocket() {
  const sent: ServerMessage[] = [];
  const socket: Socket = { send: (m) => sent.push(m), isOpen: () => true };
  return { socket, sent };
}

function fakeRunTurn() {
  const turns: Array<{
    input: AgentTurnInput;
    finish(): void;
    fail(error: Error): void;
    interrupt: ReturnType<typeof vi.fn>;
  }> = [];
  const runTurn = (input: AgentTurnInput) => {
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const done = new Promise<void>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const interrupt = vi.fn(async () => undefined);
    turns.push({ input, finish, fail, interrupt });
    return { done, interrupt };
  };
  return { runTurn, turns };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(capabilities?: TurnManagerDeps['capabilities']) {
  const fake = fakeRunTurn();
  const codex = fakeRunTurn();
  const sessions = { assertBelongs: vi.fn(async (): Promise<void> => undefined) };
  const turns = new TurnManager({
    getWorkspace: async (id) => (id === 'w1' ? ws : undefined),
    runners: { claude: fake.runTurn, codex: codex.runTurn },
    sessions,
    capabilities,
  });
  return { fake, codex, sessions, turns };
}

const send = (extra: Record<string, unknown> = {}) => ({
  type: 'chat.send' as const,
  agent: 'claude' as const,
  workspaceId: 'w1',
  text: 'hi',
  clientTurnId: 'c1',
  ...extra,
});

it('CLI重启排斥准备期回合，重启期间不允许新回合插入', async () => {
  let releaseProject!: (value: Workspace) => void;
  const project = new Promise<Workspace>((resolve) => {
    releaseProject = resolve;
  });
  const turns = new TurnManager({ getWorkspace: () => project, runners: {}, sessions: { assertBelongs: vi.fn() } });
  const socket = fakeSocket();
  const preparing = turns.handle(socket.socket, send());
  const restart = vi.fn(async () => undefined);
  await expect(turns.withIdleAgent('claude', restart)).rejects.toThrow('运行');
  expect(restart).not.toHaveBeenCalled();
  turns.socketClosed(socket.socket);
  await preparing;
  releaseProject(ws);
  let releaseRestart!: () => void;
  const restarting = turns.withIdleAgent(
    'claude',
    () =>
      new Promise<void>((resolve) => {
        releaseRestart = resolve;
      }),
  );
  const second = fakeSocket();
  await turns.handle(second.socket, send());
  expect(second.sent).toEqual([expect.objectContaining({ type: 'error', message: expect.stringContaining('重启') })]);
  releaseRestart();
  await restarting;
});

it('连接关闭时中断所属运行回合，取消准备中的启动且不影响另一连接', async () => {
  const { turns, fake, sessions } = setup();
  const first = fakeSocket();
  const other = fakeSocket();
  await turns.handle(first.socket, send({ sessionId: 'first' }));
  await turns.handle(other.socket, send({ sessionId: 'other' }));
  turns.socketClosed(first.socket);
  expect(fake.turns[0]!.interrupt).toHaveBeenCalledOnce();
  expect(fake.turns[1]!.interrupt).not.toHaveBeenCalled();
  let release!: () => void;
  sessions.assertBelongs.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const preparing = fakeSocket();
  const pending = turns.handle(preparing.socket, send({ sessionId: 'preparing' }));
  await vi.waitFor(() => expect(sessions.assertBelongs).toHaveBeenCalledTimes(3));
  turns.socketClosed(preparing.socket);
  await pending;
  release();
  await flush();
  expect(fake.turns).toHaveLength(2);
  fake.turns[0]!.finish();
  fake.turns[1]!.finish();
  await flush();
  await turns.dispose();
});

describe('TurnManager', () => {
  it('原生能力解析在启动前完成，纯上下文命令照常交给适配器', async () => {
    const prepare = vi.fn(async () => ({
      text: '',
      invocation: { kind: 'command' as const, name: 'compact' as const },
    }));
    const { turns, codex } = setup({ prepare });
    await turns.handle(
      fakeSocket().socket,
      send({ agent: 'codex', sessionId: 'native', selection: { id: 'compact' }, text: '' }),
    );
    expect(codex.turns[0]!.input).toMatchObject({ text: '', invocation: { kind: 'command', name: 'compact' } });
    codex.turns[0]!.finish();
    await flush();
    prepare.mockRejectedValueOnce(new SessionError(400, 'capability_missing', '技能已变化'));
    const rejected = fakeSocket();
    await turns.handle(rejected.socket, send({ agent: 'codex', selection: { id: 'stale' } }));
    expect(codex.turns).toHaveLength(1);
    expect(rejected.sent.at(-2)).toMatchObject({ type: 'error', message: '技能已变化' });
  });

  it('能力发现中取消后，迟到结果不能启动适配器', async () => {
    let resolve!: (value: { text: string }) => void;
    const { turns, fake } = setup({
      prepare: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const current = fakeSocket();
    const pending = turns.handle(current.socket, send({ selection: { id: 'skill' } }));
    await flush();
    const start = current.sent.find((message) => message.type === 'turn.started')!;
    await turns.handle(current.socket, { type: 'chat.interrupt', turnId: start.turnId });
    await pending;
    resolve({ text: '迟到输入' });
    await flush();
    expect(fake.turns).toHaveLength(0);
  });

  it('会话管理与运行互斥，同 ID 的另一 Agent 可独立操作', async () => {
    const { turns, fake } = setup();
    const session = { agent: 'claude' as const, sessionId: 'managed' };
    const mutation = vi.fn(async () => undefined);
    await turns.handle(fakeSocket().socket, send({ sessionId: session.sessionId }));
    await expect(turns.withIdleSession(session, mutation)).rejects.toMatchObject({ status: 409 });
    expect(mutation).not.toHaveBeenCalled();
    await turns.withIdleSession({ ...session, agent: 'codex' }, mutation);
    expect(mutation).toHaveBeenCalledOnce();
    fake.turns[0]!.finish();
    await flush();
    await turns.withIdleSession(session, mutation);
    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it('管理在异步校验前占锁，失败后释放，关闭后拒绝新管理操作', async () => {
    const { turns, fake } = setup();
    const session = { agent: 'claude' as const, sessionId: 'managed' };
    let rejectOperation!: (reason: Error) => void;
    const pending = turns.withIdleSession(
      session,
      () =>
        new Promise<void>((_, reject) => {
          rejectOperation = reject;
        }),
    );
    const rejected = expect(pending).rejects.toThrow('原生操作失败');
    const second = vi.fn(async () => undefined);
    await expect(turns.withIdleSession(session, second)).rejects.toMatchObject({ status: 409 });
    const socket = fakeSocket();
    await turns.handle(socket.socket, send({ sessionId: session.sessionId }));
    expect(fake.turns).toHaveLength(0);
    expect(socket.sent.at(-1)).toMatchObject({ type: 'error', clientTurnId: 'c1' });
    rejectOperation(new Error('原生操作失败'));
    await rejected;
    await turns.withIdleSession(session, second);
    expect(second).toHaveBeenCalledOnce();
    await turns.dispose();
    await expect(turns.withIdleSession(session, second)).rejects.toMatchObject({ status: 503 });
    expect(second).toHaveBeenCalledOnce();
  });

  it('turn.started → agent.event → turn.finished', async () => {
    const { fake, turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send());
    const turnId = (sent[0] as { turnId: string }).turnId;
    expect(sent[0]).toEqual({ type: 'turn.started', turnId, clientTurnId: 'c1', workspaceId: 'w1', agent: 'claude' });
    const ev: AgentEvent = { type: 'text', delta: '你好' };
    fake.turns[0]!.input.emit(ev);
    fake.turns[0]!.finish();
    await flush();
    expect(sent.slice(1)).toEqual([
      { type: 'agent.event', turnId, event: ev },
      { type: 'turn.finished', turnId, workspaceId: 'w1', agent: 'claude' },
    ]);
  });

  it('同一会话正在运行时拒绝再次发送', async () => {
    const { turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send({ sessionId: 's1' }));
    await turns.handle(socket, send({ sessionId: 's1', clientTurnId: 'c2' }));
    expect(sent.at(-1)).toEqual({ type: 'error', clientTurnId: 'c2', message: '该会话正在运行' });
  });

  it('新会话拿到 sessionId 后也会占用该会话', async () => {
    const { fake, turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send());
    fake.turns[0]!.input.emit({ type: 'session', sessionId: 's9', model: 'm', cwd: ws.dir });
    await turns.handle(socket, send({ sessionId: 's9', clientTurnId: 'c2' }));
    expect(sent.at(-1)).toEqual({ type: 'error', clientTurnId: 'c2', message: '该会话正在运行' });
  });

  it('未知工作区返回 error', async () => {
    const { turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send({ workspaceId: 'nope' }));
    expect(sent.map((message) => message.type)).toEqual(['turn.started', 'error', 'turn.finished']);
    expect(sent[1]).toMatchObject({ type: 'error', message: '工作区不存在' });
  });

  it('chat.interrupt 调用适配器的 interrupt', async () => {
    const { fake, turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send());
    const turnId = (sent[0] as { turnId: string }).turnId;
    await turns.handle(fakeSocket().socket, { type: 'chat.interrupt', turnId });
    expect(fake.turns[0]!.interrupt).not.toHaveBeenCalled();
    await turns.handle(socket, { type: 'chat.interrupt', turnId });
    expect(fake.turns[0]!.interrupt).toHaveBeenCalled();
  });

  it('permission.respond 把答复交给等待中的请求', async () => {
    const { fake, turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send());
    const pending = fake.turns[0]!.input.requestPermission({
      requestId: 'p1',
      toolName: 'Bash',
      input: { command: 'ls' },
    });
    const turnId = (sent[0] as { turnId: string }).turnId;
    const settled = vi.fn();
    void pending.then(settled);
    await turns.handle(fakeSocket().socket, { type: 'permission.respond', turnId, requestId: 'p1', allow: true });
    await turns.handle(socket, { type: 'permission.respond', turnId: 'other-turn', requestId: 'p1', allow: true });
    await flush();
    expect(settled).not.toHaveBeenCalled();
    await turns.handle(socket, {
      type: 'permission.respond',
      turnId,
      requestId: 'p1',
      allow: false,
      message: '不允许',
    });
    expect(await pending).toEqual({ allow: false, message: '不允许' });
  });

  it('连接关闭或原生取消后拒绝迟到审批，另一连接的轮次仍可正常结束', async () => {
    const { fake, turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send());
    const other = fakeSocket();
    await turns.handle(other.socket, send({ clientTurnId: 'other-client' }));
    const first = fake.turns[0]!;
    const second = fake.turns[1]!;
    const turnId = (sent[0] as { turnId: string }).turnId;
    const otherId = (other.sent[0] as { turnId: string }).turnId;
    const disconnected = first.input.requestPermission({ requestId: 'closed-request', toolName: 'command', input: {} });
    const cancelled = second.input.requestPermission({ requestId: 'native-request', toolName: 'command', input: {} });
    const before = sent.length;
    turns.socketClosed(socket);
    expect(await disconnected).toMatchObject({ allow: false, message: '网页连接已断开' });
    await turns.handle(socket, { type: 'permission.respond', turnId, requestId: 'closed-request', allow: true });
    expect(
      await first.input.requestPermission({ requestId: 'late-request', toolName: 'command', input: {} }),
    ).toMatchObject({ allow: false });
    second.input.emit({ type: 'permission_resolved', requestId: 'native-request', decision: 'cancelled' });
    expect(await cancelled).toMatchObject({ allow: false, message: '原生确认请求已结束' });
    await turns.handle(other.socket, {
      type: 'permission.respond',
      turnId: otherId,
      requestId: 'native-request',
      allow: true,
    });
    const ending = second.input.requestPermission({ requestId: 'ending-request', toolName: 'command', input: {} });
    first.input.emit({ type: 'text', delta: '断开后输出' });
    first.finish();
    second.finish();
    await flush();
    expect(await ending).toMatchObject({ allow: false, message: '本轮已结束' });
    await turns.handle(other.socket, {
      type: 'permission.respond',
      turnId: otherId,
      requestId: 'ending-request',
      allow: true,
    });
    expect(
      await second.input.requestPermission({ requestId: 'after-finish', toolName: 'command', input: {} }),
    ).toMatchObject({ allow: false });
    const finishedCount = other.sent.length;
    second.input.emit({ type: 'text', delta: '结束后输出' });
    expect(other.sent).toHaveLength(finishedCount);
    expect(other.sent.at(-1)).toMatchObject({ type: 'turn.finished', turnId: otherId });
    expect(sent.length).toBe(before);
  });

  it('同 ID 的两类 Agent 分别续接，验证失败时不启动适配器', async () => {
    const { fake, codex, sessions, turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send({ sessionId: 'same', agent: 'claude' }));
    await turns.handle(
      socket,
      send({ sessionId: 'same', agent: 'codex', clientTurnId: 'c2', reasoningEffort: 'high' }),
    );
    expect(fake.turns).toHaveLength(1);
    expect(codex.turns).toHaveLength(1);
    expect(codex.turns[0]!.input).toMatchObject({ sessionId: 'same', reasoningEffort: 'high' });
    sessions.assertBelongs.mockRejectedValueOnce(new SessionError(404, 'session_missing', '会话不属于当前工作区'));
    await turns.handle(socket, send({ sessionId: 'foreign', clientTurnId: 'c3' }));
    expect(sent.at(-2)).toMatchObject({ type: 'error', message: '会话不属于当前工作区' });
    expect(fake.turns).toHaveLength(1);
    fake.turns[0]!.finish();
    codex.turns[0]!.finish();
    await flush();
  });

  it('准备阶段已能中断，迟到的验证结果不会启动 Agent', async () => {
    const { fake, sessions, turns } = setup();
    const { socket, sent } = fakeSocket();
    let ready!: () => void;
    sessions.assertBelongs.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    const sending = turns.handle(socket, send({ sessionId: 's1' }));
    await flush();
    const turnId = (sent[0] as { turnId: string }).turnId;
    await turns.handle(socket, { type: 'chat.interrupt', turnId });
    await sending;
    ready();
    await flush();
    expect(fake.turns).toHaveLength(0);
    expect(sent.at(-1)).toMatchObject({ type: 'turn.finished', turnId });
  });
  it('轮次结束后正常收尾，并保持仅一轮 Agent 调用', async () => {
    const { fake, turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send());
    fake.turns[0]!.finish();
    await flush();
    expect(fake.turns).toHaveLength(1);
    expect(sent.at(-1)?.type).toBe('turn.finished');
  });

  it('关闭立即停止已有轮次，准备中的请求与新启动均不能继续', async () => {
    const { fake, codex, sessions, turns } = setup();
    const first = fakeSocket();
    const second = fakeSocket();
    await turns.handle(first.socket, send({ sessionId: 'claude-session' }));
    await turns.handle(second.socket, send({ sessionId: 'codex-session', agent: 'codex' }));
    const claude = fake.turns[0]!;
    const native = codex.turns[0]!;
    let verified!: () => void;
    sessions.assertBelongs.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          verified = resolve;
        }),
    );
    const preparing = turns.handle(
      fakeSocket().socket,
      send({ sessionId: 'preparing', clientTurnId: 'preparing-client' }),
    );
    await flush();
    const closing = turns.dispose();
    expect(claude.interrupt).toHaveBeenCalledOnce();
    expect(native.interrupt).toHaveBeenCalledOnce();
    const newcomer = fakeSocket();
    await turns.handle(newcomer.socket, send({ clientTurnId: 'too-late' }));
    expect(newcomer.sent).toEqual([{ type: 'error', clientTurnId: 'too-late', message: '后端正在关闭，请稍后重试' }]);
    await preparing;
    verified();
    claude.finish();
    native.finish();
    await closing;
    await flush();
    expect(fake.turns).toHaveLength(1);
    expect(codex.turns).toHaveLength(1);
    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(1);
  });

  it('原生会话抢占或改变身份会停止错误轮次，不能转移或误删其他会话的运行锁', async () => {
    const { fake, turns } = setup();
    const owner = fakeSocket();
    const contender = fakeSocket();
    await turns.handle(owner.socket, send({ sessionId: 'owned' }));
    await turns.handle(contender.socket, send({ clientTurnId: 'contender' }));
    fake.turns[1]!.input.emit({ type: 'session', sessionId: 'owned', model: 'native-model', cwd: ws.dir });
    expect(contender.sent.at(-1)).toMatchObject({ type: 'error', message: '原生会话身份发生变化，已停止本轮' });
    expect(fake.turns[1]!.interrupt).toHaveBeenCalledOnce();
    fake.turns[1]!.finish();
    await flush();
    const retry = fakeSocket();
    await turns.handle(retry.socket, send({ sessionId: 'owned', clientTurnId: 'still-owned' }));
    expect(retry.sent.at(-1)).toMatchObject({ type: 'error', clientTurnId: 'still-owned', message: '该会话正在运行' });
    fake.turns[0]!.input.emit({ type: 'session', sessionId: 'unclaimed', model: 'native-model', cwd: ws.dir });
    expect(fake.turns[0]!.interrupt).toHaveBeenCalledOnce();
    await turns.handle(retry.socket, send({ sessionId: 'unclaimed', clientTurnId: 'new-identity' }));
    expect(fake.turns).toHaveLength(3);
    expect(fake.turns[2]!.input.sessionId).toBe('unclaimed');
    fake.turns[0]!.finish();
    await flush();
    await turns.handle(retry.socket, send({ sessionId: 'owned', clientTurnId: 'released-identity' }));
    expect(fake.turns).toHaveLength(4);
    fake.turns[2]!.finish();
    fake.turns[3]!.finish();
    await flush();
  });

  it('异步运行失败完整收尾，审批撤销后可以重新续接', async () => {
    const { fake, turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send({ sessionId: 'retry-session' }));
    const first = fake.turns[0]!;
    const pending = first.input.requestPermission({
      requestId: 'failed-turn-approval',
      toolName: 'command',
      input: {},
    });
    first.fail(new Error('内部运行时诊断'));
    await flush();
    expect(await pending).toMatchObject({ allow: false, message: '本轮已结束' });
    expect(sent.map((message) => message.type)).toEqual(['turn.started', 'error', 'turn.finished']);
    expect(JSON.stringify(sent)).not.toContain('内部');
    await turns.handle(socket, send({ sessionId: 'retry-session', clientTurnId: 'retry-client' }));
    expect(fake.turns).toHaveLength(2);
    fake.turns[1]!.finish();
    await flush();
    expect(sent.at(-1)).toMatchObject({ type: 'turn.finished' });
  });
});

it('准备阶段取消后不启动runner', async () => {
  let release!: () => void;
  const prepare = vi.fn(
    () =>
      new Promise<{ text: string }>((resolve) => {
        release = () => resolve({ text: 'hi' });
      }),
  );
  const f = setup({ prepare });
  const socket = fakeSocket();
  const starting = f.turns.handle(socket.socket, send());
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  const first = socket.sent.find((message) => message.type === 'turn.started')!;
  if (first.type !== 'turn.started') throw new Error('未开始轮次');
  await f.turns.handle(socket.socket, { type: 'chat.interrupt', turnId: first.turnId });
  await starting;
  expect(f.fake.turns).toHaveLength(0);
  expect(socket.sent.at(-1)).toMatchObject({ type: 'turn.finished' });
  // 迟到结果不能补启动适配器。
  release();
  await flush();
  expect(f.fake.turns).toHaveLength(0);
  await f.turns.dispose();
});

it('没有原生文件事件时 turn.finished 不带 changes', async () => {
  const f = setup();
  const socket = fakeSocket();
  await f.turns.handle(socket.socket, send());
  expect(f.fake.turns).toHaveLength(1);
  f.fake.turns[0]!.finish();
  await vi.waitFor(() => expect(socket.sent.at(-1)).toMatchObject({ type: 'turn.finished' }));
  const finished = socket.sent.find((message) => message.type === 'turn.finished');
  expect(finished).toMatchObject({ type: 'turn.finished' });
  expect(finished && 'changes' in finished ? finished.changes : undefined).toBeUndefined();
  await f.turns.dispose();
});

it('Claude轮次不丢弃推理强度，未指定时沿用原生设置', async () => {
  const { turns, fake } = setup();
  const socket = fakeSocket();
  await turns.handle(socket.socket, send({ model: 'supported-model', reasoningEffort: 'high' }));
  expect(fake.turns[0]!.input).toMatchObject({ model: 'supported-model', reasoningEffort: 'high' });
  fake.turns[0]!.finish();
  await flush();
  await turns.handle(socket.socket, send({ clientTurnId: 'next' }));
  expect(fake.turns[1]!.input.reasoningEffort).toBeUndefined();
  fake.turns[1]!.finish();
  await flush();
  await turns.dispose();
});
