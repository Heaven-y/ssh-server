import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  SyncSettingsSchema,
  type AgentEvent,
  type ServerMessage,
  type SyncStatus,
  type Workspace,
} from '@ssh-server/shared';
import type { AgentTurnInput } from '../../src/agents/types';
import { createSessionRegistry } from '../../src/chat/registry';
import { SessionError } from '../../src/chat/sessions';
import { TurnManager, type Socket } from '../../src/chat/turn-manager';

const ws: Workspace = {
  id: 'w1',
  name: 'demo',
  localDir: path.join(os.tmpdir(), 'ssh-server-fixture', 'demo'),
  sshHost: 'my-server',
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

function setup(syncOperation?: (workspace: Workspace) => Promise<SyncStatus>) {
  const registry = createSessionRegistry();
  const fake = fakeRunTurn();
  const codex = fakeRunTurn();
  const sessions = { assertBelongs: vi.fn(async (): Promise<void> => undefined) };
  const sync = {
    sync: vi.fn(
      syncOperation ??
        (async () => ({
          phase: 'ready' as const,
          deletions: [],
          conflicts: [],
          settings: SyncSettingsSchema.parse({}),
        })),
    ),
  };
  const turns = new TurnManager({
    getWorkspace: async (id) => (id === 'w1' ? ws : undefined),
    registry,
    internalUrl: () => 'http://127.0.0.1:1',
    runTurn: fake.runTurn,
    runners: { codex: codex.runTurn },
    sessions,
    sync,
  });
  return { registry, fake, codex, sessions, turns, sync };
}

const send = (extra: Record<string, unknown> = {}) => ({
  type: 'chat.send' as const,
  workspaceId: 'w1',
  text: 'hi',
  clientTurnId: 'c1',
  ...extra,
});

describe('TurnManager', () => {
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

  it('把内部地址与会话令牌传给适配器，结束后注销令牌', async () => {
    const { fake, turns, registry } = setup();
    await turns.handle(fakeSocket().socket, send());
    const env = fake.turns[0]!.input.mcpEnv;
    expect(env.SSH_SERVER_INTERNAL_URL).toBe('http://127.0.0.1:1');
    expect(registry.resolve(env.SSH_SERVER_SESSION_TOKEN!)).toBe('w1');
    fake.turns[0]!.finish();
    await flush();
    expect(registry.resolve(env.SSH_SERVER_SESSION_TOKEN!)).toBeUndefined();
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
    fake.turns[0]!.input.emit({ type: 'session', sessionId: 's9', model: 'm', cwd: ws.localDir });
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
    const { fake, sessions, turns, sync } = setup();
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
    expect(sync.sync).not.toHaveBeenCalled();
    expect(sent.at(-1)).toMatchObject({ type: 'turn.finished', turnId });
  });
  it('轮次结束后同步，并保持仅一轮 Agent 调用', async () => {
    const { fake, turns, sync } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send());
    fake.turns[0]!.finish();
    await flush();
    expect(sync.sync).toHaveBeenCalledWith(ws);
    expect(fake.turns).toHaveLength(1);
    expect(sent.at(-1)?.type).toBe('turn.finished');
  });

  it('关闭立即撤销令牌并停止已有轮次，准备中的请求与新启动均不能继续', async () => {
    const { fake, codex, sessions, registry, turns } = setup();
    const first = fakeSocket();
    const second = fakeSocket();
    await turns.handle(first.socket, send({ sessionId: 'claude-session' }));
    await turns.handle(second.socket, send({ sessionId: 'codex-session', agent: 'codex' }));
    const claude = fake.turns[0]!;
    const native = codex.turns[0]!;
    const token = claude.input.mcpEnv.SSH_SERVER_SESSION_TOKEN!;
    const codexToken = native.input.mcpEnv.SSH_SERVER_SESSION_TOKEN!;
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
    expect(registry.resolve(token)).toBeUndefined();
    expect(registry.resolve(codexToken)).toBeUndefined();
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
    fake.turns[1]!.input.emit({ type: 'session', sessionId: 'owned', model: 'native-model', cwd: ws.localDir });
    expect(contender.sent.at(-1)).toMatchObject({ type: 'error', message: '原生会话身份发生变化，已停止本轮' });
    expect(fake.turns[1]!.interrupt).toHaveBeenCalledOnce();
    fake.turns[1]!.finish();
    await flush();
    const retry = fakeSocket();
    await turns.handle(retry.socket, send({ sessionId: 'owned', clientTurnId: 'still-owned' }));
    expect(retry.sent.at(-1)).toMatchObject({ type: 'error', clientTurnId: 'still-owned', message: '该会话正在运行' });
    fake.turns[0]!.input.emit({ type: 'session', sessionId: 'unclaimed', model: 'native-model', cwd: ws.localDir });
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

  it('异步运行失败与同步异常均完整收尾，令牌和审批撤销后可以重新续接', async () => {
    const synchronize = vi
      .fn<(workspace: Workspace) => Promise<SyncStatus>>()
      .mockRejectedValueOnce(new Error('内部同步诊断'))
      .mockResolvedValueOnce({
        phase: 'confirmation_required',
        reason: 'deletions',
        deletions: ['example.txt'],
        conflicts: [],
        settings: SyncSettingsSchema.parse({}),
      });
    const { fake, registry, turns } = setup(synchronize);
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send({ sessionId: 'retry-session' }));
    const first = fake.turns[0]!;
    const token = first.input.mcpEnv.SSH_SERVER_SESSION_TOKEN!;
    const pending = first.input.requestPermission({
      requestId: 'failed-turn-approval',
      toolName: 'command',
      input: {},
    });
    first.fail(new Error('内部运行时诊断'));
    await flush();
    expect(registry.resolve(token)).toBeUndefined();
    expect(await pending).toMatchObject({ allow: false, message: '本轮已结束' });
    expect(sent.map((message) => message.type)).toEqual(['turn.started', 'error', 'error', 'turn.finished']);
    expect(JSON.stringify(sent)).not.toContain('内部');
    await turns.handle(socket, send({ sessionId: 'retry-session', clientTurnId: 'retry-client' }));
    expect(fake.turns).toHaveLength(2);
    fake.turns[1]!.finish();
    await flush();
    expect(sent.at(-2)).toMatchObject({ type: 'error', message: '同步尚未就绪，请在同步面板处理后继续' });
    expect(sent.at(-1)).toMatchObject({ type: 'turn.finished' });
    const secondToken = fake.turns[1]!.input.mcpEnv.SSH_SERVER_SESSION_TOKEN!;
    expect(registry.resolve(secondToken)).toBeUndefined();
  });
});
