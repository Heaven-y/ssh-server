import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ServerMessage, Workspace } from '@ssh-server/shared';
import type { ClaudeTurnInput } from '../agents/claude-adapter';
import { createSessionRegistry } from './registry';
import { TurnManager, type Socket } from './turn-manager';

const ws: Workspace = { id: 'w1', name: 'demo', localDir: 'D:/w', sshHost: 'my-server', remoteDir: '~/projects/demo' };

function fakeSocket() {
  const sent: ServerMessage[] = [];
  const socket: Socket = { send: (m) => sent.push(m), isOpen: () => true };
  return { socket, sent };
}

function fakeRunTurn() {
  const turns: Array<{ input: ClaudeTurnInput; finish: () => void; interrupt: ReturnType<typeof vi.fn> }> = [];
  const runTurn = (input: ClaudeTurnInput) => {
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    const interrupt = vi.fn(async () => undefined);
    turns.push({ input, finish, interrupt });
    return { done, interrupt };
  };
  return { runTurn, turns };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const registry = createSessionRegistry();
  const fake = fakeRunTurn();
  const turns = new TurnManager({
    getWorkspace: async (id) => (id === 'w1' ? ws : undefined),
    registry,
    internalUrl: () => 'http://127.0.0.1:1',
    runTurn: fake.runTurn,
  });
  return { registry, fake, turns };
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
    expect(sent[0]).toEqual({ type: 'turn.started', turnId, clientTurnId: 'c1' });
    const ev: AgentEvent = { type: 'text', delta: '你好' };
    fake.turns[0]!.input.emit(ev);
    fake.turns[0]!.finish();
    await flush();
    expect(sent.slice(1)).toEqual([
      { type: 'agent.event', turnId, event: ev },
      { type: 'turn.finished', turnId },
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
    expect(sent.at(-1)).toEqual({ type: 'error', message: '该会话正在运行' });
  });

  it('新会话拿到 sessionId 后也会占用该会话', async () => {
    const { fake, turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send());
    fake.turns[0]!.input.emit({ type: 'session', sessionId: 's9', model: 'm', cwd: 'D:/w' });
    await turns.handle(socket, send({ sessionId: 's9', clientTurnId: 'c2' }));
    expect(sent.at(-1)).toEqual({ type: 'error', message: '该会话正在运行' });
  });

  it('未知工作区返回 error', async () => {
    const { turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send({ workspaceId: 'nope' }));
    expect(sent).toEqual([{ type: 'error', message: '工作区不存在' }]);
  });

  it('chat.interrupt 调用适配器的 interrupt', async () => {
    const { fake, turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send());
    const turnId = (sent[0] as { turnId: string }).turnId;
    await turns.handle(socket, { type: 'chat.interrupt', turnId });
    expect(fake.turns[0]!.interrupt).toHaveBeenCalled();
  });

  it('permission.respond 把答复交给等待中的请求', async () => {
    const { fake, turns } = setup();
    const { socket } = fakeSocket();
    await turns.handle(socket, send());
    const pending = fake.turns[0]!.input.requestPermission({
      requestId: 'p1',
      toolName: 'Bash',
      input: { command: 'ls' },
    });
    await turns.handle(socket, { type: 'permission.respond', requestId: 'p1', allow: false, message: '不允许' });
    expect(await pending).toEqual({ allow: false, message: '不允许' });
  });

  it('连接关闭后不再发送，轮次照常结束', async () => {
    const { fake, turns } = setup();
    const { socket, sent } = fakeSocket();
    await turns.handle(socket, send());
    const before = sent.length;
    turns.socketClosed(socket);
    fake.turns[0]!.input.emit({ type: 'text', delta: 'x' });
    fake.turns[0]!.finish();
    await flush();
    expect(sent.length).toBe(before);
  });
});
