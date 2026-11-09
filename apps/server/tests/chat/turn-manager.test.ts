import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ServerMessage } from '@agentdeck/shared/conversation';
import type { Workspace } from '@agentdeck/shared/projects';
import type { AgentTurnInput } from '../../src/agents/contracts';
import { SessionError } from '../../src/agents/errors';
import { SessionPreferencesError } from '../../src/sessions/preferences';
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
    interrupt: ReturnType<typeof vi.fn<() => Promise<void>>>;
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
  const sessions = { assertBelongs: vi.fn(async (): Promise<Workspace | void> => undefined) };
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

it('连接关闭时中断所属全部回合，取消准备中的启动且不影响另一连接', async () => {
  const { turns, fake, sessions } = setup();
  const first = fakeSocket();
  const other = fakeSocket();
  await turns.handle(first.socket, send({ sessionId: 'first' }));
  await turns.handle(first.socket, send({ sessionId: 'second', clientTurnId: 'c2' }));
  await turns.handle(other.socket, send({ sessionId: 'other', clientTurnId: 'other-client' }));
  const firstApproval = fake.turns[0]!.input.requestPermission({ requestId: 'p1', toolName: 'command', input: {} });
  const secondApproval = fake.turns[1]!.input.requestPermission({ requestId: 'p2', toolName: 'command', input: {} });
  turns.socketClosed(first.socket);
  expect(fake.turns[0]!.interrupt).toHaveBeenCalledOnce();
  expect(fake.turns[1]!.interrupt).toHaveBeenCalledOnce();
  expect(fake.turns[2]!.interrupt).not.toHaveBeenCalled();
  expect(await firstApproval).toMatchObject({ allow: false, message: '网页连接已断开' });
  expect(await secondApproval).toMatchObject({ allow: false, message: '网页连接已断开' });
  let release!: () => void;
  sessions.assertBelongs.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const preparing = fakeSocket();
  const pending = turns.handle(preparing.socket, send({ sessionId: 'preparing' }));
  await vi.waitFor(() => expect(sessions.assertBelongs).toHaveBeenCalledTimes(4));
  turns.socketClosed(preparing.socket);
  await pending;
  release();
  await flush();
  expect(fake.turns).toHaveLength(3);
  fake.turns[0]!.finish();
  fake.turns[1]!.finish();
  fake.turns[2]!.finish();
  await flush();
  await turns.dispose();
});

describe('TurnManager', () => {
  it('续接子目录会话时能力解析和运行均使用原生 cwd，保留项目身份', async () => {
    const prepare = vi.fn(async () => ({ text: '继续' }));
    const { turns, fake, sessions } = setup({ prepare });
    const native = { ...ws, dir: path.join(ws.dir, 'child') };
    sessions.assertBelongs.mockResolvedValueOnce(native);
    await turns.handle(fakeSocket().socket, send({ sessionId: 'native' }));
    expect(prepare).toHaveBeenCalledWith(
      native,
      'claude',
      expect.objectContaining({ sessionId: 'native' }),
      expect.any(AbortSignal),
    );
    expect(fake.turns[0]?.input.workspace).toEqual(native);
    fake.turns[0]!.finish();
    await flush();
    await turns.dispose();
  });

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

  it('同一连接的两条会话分别审批，停止一条不影响另一条继续输出', async () => {
    const { fake, turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send({ sessionId: 'session-a', clientTurnId: 'client-a' }));
    await turns.handle(socket, send({ sessionId: 'session-b', clientTurnId: 'client-b' }));
    const starts = sent.filter((message) => message.type === 'turn.started');
    const a = fake.turns[0]!;
    const b = fake.turns[1]!;
    const aId = starts[0]!.turnId;
    const bId = starts[1]!.turnId;
    const aAnswer = a.input.requestPermission({ requestId: 'approve-a', toolName: 'command', input: {} });
    const bAnswer = b.input.requestPermission({ requestId: 'approve-b', toolName: 'command', input: {} });
    const bSettled = vi.fn();
    void bAnswer.then(bSettled);
    await turns.handle(socket, { type: 'permission.respond', turnId: aId, requestId: 'approve-b', allow: true });
    await turns.handle(socket, { type: 'permission.respond', turnId: aId, requestId: 'approve-a', allow: true });
    expect(await aAnswer).toMatchObject({ allow: true });
    expect(bSettled).not.toHaveBeenCalled();

    await turns.handle(socket, { type: 'chat.interrupt', turnId: aId });
    expect(a.interrupt).toHaveBeenCalledOnce();
    expect(b.interrupt).not.toHaveBeenCalled();
    a.finish();
    await flush();
    expect(turns.isRunning({ agent: 'claude', sessionId: 'session-a' })).toBe(false);
    expect(turns.isRunning({ agent: 'claude', sessionId: 'session-b' })).toBe(true);
    expect(bSettled).not.toHaveBeenCalled();
    expect(sent.filter((message) => message.type === 'turn.finished')).toEqual([
      { type: 'turn.finished', turnId: aId, workspaceId: 'w1', agent: 'claude' },
    ]);

    await turns.handle(socket, { type: 'permission.respond', turnId: bId, requestId: 'approve-b', allow: false });
    expect(await bAnswer).toMatchObject({ allow: false });
    b.input.emit({ type: 'text', delta: '会话 B 继续执行' });
    expect(sent.at(-1)).toEqual({
      type: 'agent.event',
      turnId: bId,
      event: { type: 'text', delta: '会话 B 继续执行' },
    });
    await turns.handle(socket, send({ sessionId: 'session-b', clientTurnId: 'duplicate' }));
    expect(sent.at(-1)).toEqual({ type: 'error', clientTurnId: 'duplicate', message: '该会话正在运行' });
    expect(fake.turns).toHaveLength(2);
    b.finish();
    await flush();
    expect(turns.isRunning({ agent: 'claude', sessionId: 'session-b' })).toBe(false);
    await turns.dispose();
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
  await turns.handle(
    socket.socket,
    send({ model: 'supported-model', reasoningEffort: 'high', permission: { agent: 'claude', mode: 'auto' } }),
  );
  expect(fake.turns[0]!.input).toMatchObject({
    model: 'supported-model',
    reasoningEffort: 'high',
    permission: { agent: 'claude', mode: 'auto' },
  });
  fake.turns[0]!.finish();
  await flush();
  await turns.handle(socket.socket, send({ clientTurnId: 'next' }));
  expect(fake.turns[1]!.input.reasoningEffort).toBeUndefined();
  expect(fake.turns[1]!.input.permission).toBeUndefined();
  fake.turns[1]!.finish();
  await flush();
  await turns.dispose();
});

it.each([false, true])('新会话首次收到原生身份后等待显式权限保存，无论模型是否失败：%s', async (failed) => {
  const fake = fakeRunTurn();
  let save!: () => void;
  const rememberPermission = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        save = resolve;
      }),
  );
  const sessions = {
    assertBelongs: vi.fn(async (): Promise<Workspace | void> => undefined),
    rememberPermission,
  };
  const turns = new TurnManager({
    getWorkspace: async () => ws,
    runners: { claude: fake.runTurn },
    sessions,
  });
  const { socket, sent } = fakeSocket();
  await turns.handle(socket, send({ permission: { agent: 'claude', mode: 'auto' } }));
  expect(rememberPermission).not.toHaveBeenCalled();
  fake.turns[0]!.input.emit({ type: 'session', sessionId: 'new-native', model: 'm', cwd: ws.dir });
  if (failed) fake.turns[0]!.fail(new Error('模型失败'));
  else fake.turns[0]!.finish();
  await vi.waitFor(() =>
    expect(rememberPermission).toHaveBeenCalledWith(
      { agent: 'claude', sessionId: 'new-native' },
      { agent: 'claude', mode: 'auto' },
    ),
  );
  expect(sent.some((message) => message.type === 'turn.finished')).toBe(false);
  expect(turns.isRunning({ agent: 'claude', sessionId: 'new-native' })).toBe(true);
  save();
  await vi.waitFor(() => expect(sent.at(-1)?.type).toBe('turn.finished'));
  expect(sent.at(-1)?.type).toBe('turn.finished');
  expect(turns.isRunning({ agent: 'claude', sessionId: 'new-native' })).toBe(false);
  await turns.dispose();
});

it('续接会话未显式指定权限时恢复工作台偏好，显式消息优先且只保存显式选择', async () => {
  const fake = fakeRunTurn();
  const permission = vi.fn(async () => ({ agent: 'claude' as const, mode: 'plan' as const }));
  const rememberPermission = vi.fn(async () => undefined);
  const sessions = {
    assertBelongs: vi.fn(async (): Promise<Workspace | void> => undefined),
    permission,
    rememberPermission,
  };
  const turns = new TurnManager({ getWorkspace: async () => ws, runners: { claude: fake.runTurn }, sessions });
  const socket = fakeSocket();
  await turns.handle(socket.socket, send({ sessionId: 'resume-native' }));
  expect(fake.turns[0]!.input.permission).toEqual({ agent: 'claude', mode: 'plan' });
  fake.turns[0]!.finish();
  await vi.waitFor(() => expect(socket.sent.at(-1)?.type).toBe('turn.finished'));
  expect(permission).toHaveBeenCalledWith({ agent: 'claude', sessionId: 'resume-native' });
  expect(rememberPermission).not.toHaveBeenCalled();
  await turns.handle(
    socket.socket,
    send({ sessionId: 'resume-native-2', permission: { agent: 'claude', mode: 'dontAsk' }, clientTurnId: 'explicit' }),
  );
  expect(fake.turns[1]!.input.permission).toEqual({ agent: 'claude', mode: 'dontAsk' });
  expect(permission).toHaveBeenCalledTimes(1);
  fake.turns[1]!.finish();
  await vi.waitFor(() =>
    expect(rememberPermission).toHaveBeenCalledWith(
      { agent: 'claude', sessionId: 'resume-native-2' },
      { agent: 'claude', mode: 'dontAsk' },
    ),
  );
  await turns.dispose();
});

it('权限元数据保存失败只提示权限未保存，不伪装模型失败且仍释放会话锁', async () => {
  const fake = fakeRunTurn();
  const rememberPermission = vi.fn(async () => {
    throw new Error('private metadata failure');
  });
  const sessions = {
    assertBelongs: vi.fn(async (): Promise<Workspace | void> => undefined),
    rememberPermission,
  };
  const turns = new TurnManager({ getWorkspace: async () => ws, runners: { claude: fake.runTurn }, sessions });
  const socket = fakeSocket();
  await turns.handle(
    socket.socket,
    send({ sessionId: 'metadata-failure', permission: { agent: 'claude', mode: 'auto' } }),
  );
  fake.turns[0]!.finish();
  await vi.waitFor(() => expect(socket.sent.at(-1)?.type).toBe('turn.finished'));
  expect(socket.sent).toContainEqual({
    type: 'error',
    turnId: expect.any(String),
    message: '会话权限未保存，请稍后重新选择。',
  });
  expect(socket.sent).not.toContainEqual({
    type: 'error',
    turnId: expect.any(String),
    message: 'Agent 运行失败，请检查本机运行时和配置',
  });
  await turns.handle(socket.socket, send({ sessionId: 'metadata-failure', clientTurnId: 'retry' }));
  expect(fake.turns).toHaveLength(2);
  fake.turns[1]!.finish();
  await turns.dispose();
});

it('关闭等待首次原生会话权限写入和锁释放，不在模型结束时提前退出', async () => {
  const fake = fakeRunTurn();
  let save!: () => void;
  const rememberPermission = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        save = resolve;
      }),
  );
  const release = vi.fn();
  const turns = new TurnManager({
    getWorkspace: async () => ws,
    runners: { claude: fake.runTurn },
    sessions: { assertBelongs: async () => ws, rememberPermission },
    acquireWorkspace: () => release,
  });
  await turns.handle(fakeSocket().socket, send({ permission: { agent: 'claude', mode: 'plan' } }));
  fake.turns[0]!.input.emit({ type: 'session', sessionId: 'new-native', model: 'm', cwd: ws.dir });
  fake.turns[0]!.interrupt.mockImplementation(async () => fake.turns[0]!.finish());
  let closed = false;
  const closing = turns.dispose().then(() => {
    closed = true;
  });
  await vi.waitFor(() => expect(rememberPermission).toHaveBeenCalledOnce());
  try {
    expect(closed).toBe(false);
    expect(release).not.toHaveBeenCalled();
  } finally {
    save();
    await closing;
  }
  expect(turns.isRunning({ agent: 'claude', sessionId: 'new-native' })).toBe(false);
  expect(release).toHaveBeenCalledOnce();
});

it('权限读取失败准确说明权限问题，不启动模型或泄漏底层信息', async () => {
  const fake = fakeRunTurn();
  const turns = new TurnManager({
    getWorkspace: async () => ws,
    runners: { claude: fake.runTurn },
    sessions: {
      assertBelongs: async () => ws,
      permission: async () => {
        throw new SessionPreferencesError();
      },
    },
  });
  const socket = fakeSocket();
  await turns.handle(socket.socket, send({ sessionId: 'native' }));
  expect(fake.turns).toHaveLength(0);
  expect(socket.sent.at(-2)).toMatchObject({ type: 'error', message: '会话权限读取失败，请重新读取权限后再发送。' });
  expect(socket.sent.at(-1)).toMatchObject({ type: 'turn.finished' });
  expect(turns.isRunning({ agent: 'claude', sessionId: 'native' })).toBe(false);
  await turns.dispose();
});

it('新会话不读取其他会话默认，未收到原生身份时不创建权限记录', async () => {
  const fake = fakeRunTurn();
  const permission = vi.fn(async () => ({ agent: 'claude' as const, mode: 'auto' as const }));
  const rememberPermission = vi.fn(async () => undefined);
  const turns = new TurnManager({
    getWorkspace: async () => ws,
    runners: { claude: fake.runTurn },
    sessions: { assertBelongs: async () => undefined, permission, rememberPermission },
  });
  const socket = fakeSocket();
  await turns.handle(socket.socket, send());
  expect(fake.turns[0]!.input.permission).toBeUndefined();
  fake.turns[0]!.finish();
  await flush();
  await turns.handle(socket.socket, send({ permission: { agent: 'claude', mode: 'plan' }, clientTurnId: 'selected' }));
  fake.turns[1]!.finish();
  await flush();
  expect(permission).not.toHaveBeenCalled();
  expect(rememberPermission).not.toHaveBeenCalled();
  await turns.dispose();
});

it('恢复权限必须在归属核验后，拒绝跨 CLI 偏好并释放准备阶段锁', async () => {
  const fake = fakeRunTurn();
  const permission = vi.fn(async () => ({ agent: 'codex' as const, mode: 'ask' as const }));
  const sessions = { assertBelongs: vi.fn(async () => undefined), permission };
  const turns = new TurnManager({ getWorkspace: async () => ws, runners: { claude: fake.runTurn }, sessions });
  const socket = fakeSocket();
  sessions.assertBelongs.mockRejectedValueOnce(new SessionError(404, 'session_missing', '无权访问'));
  await turns.handle(socket.socket, send({ sessionId: 'foreign' }));
  expect(permission).not.toHaveBeenCalled();
  await turns.handle(socket.socket, send({ sessionId: 'foreign', clientTurnId: 'retry' }));
  expect(fake.turns).toHaveLength(0);
  expect(socket.sent.at(-2)).toMatchObject({ type: 'error', message: '权限模式不属于当前 CLI' });
  expect(turns.isRunning({ agent: 'claude', sessionId: 'foreign' })).toBe(false);
  await turns.dispose();
});

it('新原生身份保存前核验其项目归属，失败仅提示权限未保存且释放锁', async () => {
  const fake = fakeRunTurn();
  const rememberPermission = vi.fn(async () => undefined);
  const sessions = {
    assertBelongs: vi.fn(async () => {
      throw new SessionError(404, 'session_missing', '无权访问');
    }),
    rememberPermission,
  };
  const turns = new TurnManager({ getWorkspace: async () => ws, runners: { claude: fake.runTurn }, sessions });
  const socket = fakeSocket();
  await turns.handle(socket.socket, send({ permission: { agent: 'claude', mode: 'auto' } }));
  fake.turns[0]!.input.emit({ type: 'session', sessionId: 'foreign', model: 'm', cwd: ws.dir });
  fake.turns[0]!.finish();
  await vi.waitFor(() => expect(socket.sent.at(-1)?.type).toBe('turn.finished'));
  expect(rememberPermission).not.toHaveBeenCalled();
  expect(socket.sent.at(-2)).toMatchObject({ type: 'error', message: '会话权限未保存，请稍后重新选择。' });
  expect(turns.isRunning({ agent: 'claude', sessionId: 'foreign' })).toBe(false);
  await turns.dispose();
});

it.each([{ sessionId: 'native', agent: 'codex' as const }, { sessionId: '../invalid' }])(
  '非法原生身份不绑定、不保存权限：$sessionId $agent',
  async (identity) => {
    const fake = fakeRunTurn();
    const rememberPermission = vi.fn(async () => undefined);
    const turns = new TurnManager({
      getWorkspace: async () => ws,
      runners: { claude: fake.runTurn },
      sessions: { assertBelongs: async () => undefined, rememberPermission },
    });
    const socket = fakeSocket();
    await turns.handle(socket.socket, send({ permission: { agent: 'claude', mode: 'plan' } }));
    fake.turns[0]!.input.emit({ type: 'session', ...identity, model: 'm', cwd: ws.dir });
    expect(fake.turns[0]!.interrupt).toHaveBeenCalledOnce();
    expect(socket.sent.at(-1)).toMatchObject({ type: 'error', message: '原生会话身份发生变化，已停止本轮' });
    fake.turns[0]!.finish();
    await flush();
    expect(rememberPermission).not.toHaveBeenCalled();
    await turns.dispose();
  },
);
