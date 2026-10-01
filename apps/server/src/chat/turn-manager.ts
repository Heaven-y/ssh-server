// 对话轮次管理：把网页的消息交给 Agent 适配器，把事件推回网页
import { randomUUID } from 'node:crypto';
import type { AgentEvent, ClientMessage, ServerMessage, Workspace } from '@ssh-server/shared';
import { runClaudeTurn, type ClaudeTurnInput, type PermissionAnswer, type TurnHandle } from '../agents/claude-adapter';
import type { SessionRegistry } from './registry';

export type Socket = { send(msg: ServerMessage): void; isOpen(): boolean };

export type TurnManagerDeps = {
  getWorkspace(id: string): Promise<Workspace | undefined>;
  registry: SessionRegistry;
  /** 后端内部接口地址（实际监听端口） */
  internalUrl(): string;
  runTurn?: (input: ClaudeTurnInput) => TurnHandle;
};

type Turn = { id: string; socket: Socket; handle?: TurnHandle; sessionId?: string };
type Pending = { turnId: string; resolve(a: PermissionAnswer): void };

export class TurnManager {
  private turns = new Map<string, Turn>();
  /** sessionId → turnId：同一会话同一时间只允许一轮 */
  private sessions = new Map<string, string>();
  private pending = new Map<string, Pending>();
  private closed = new WeakSet<Socket>();
  private readonly runTurn: (input: ClaudeTurnInput) => TurnHandle;

  constructor(private readonly deps: TurnManagerDeps) {
    this.runTurn = deps.runTurn ?? runClaudeTurn;
  }

  async handle(socket: Socket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'chat.send':
        return this.start(socket, msg);
      case 'chat.interrupt':
        await this.turns.get(msg.turnId)?.handle?.interrupt();
        return;
      case 'permission.respond': {
        const p = this.pending.get(msg.requestId);
        if (p) {
          this.pending.delete(msg.requestId);
          p.resolve({ allow: msg.allow, message: msg.message });
        }
        return;
      }
    }
  }

  /** 连接关闭：不再向它发送；轮次继续运行，待确认的权限请求由适配器超时拒绝 */
  socketClosed(socket: Socket): void {
    this.closed.add(socket);
  }

  private send(socket: Socket, msg: ServerMessage): void {
    if (!this.closed.has(socket) && socket.isOpen()) socket.send(msg);
  }

  private async start(socket: Socket, msg: Extract<ClientMessage, { type: 'chat.send' }>): Promise<void> {
    const ws = await this.deps.getWorkspace(msg.workspaceId);
    if (!ws) return this.send(socket, { type: 'error', message: '工作区不存在' });
    if (msg.sessionId && this.sessions.has(msg.sessionId)) return this.send(socket, { type: 'error', message: '该会话正在运行' });

    const turn: Turn = { id: randomUUID(), socket, sessionId: msg.sessionId };
    this.turns.set(turn.id, turn);
    if (msg.sessionId) this.sessions.set(msg.sessionId, turn.id);
    const token = this.deps.registry.register(ws.id);
    this.send(socket, { type: 'turn.started', turnId: turn.id, clientTurnId: msg.clientTurnId });

    const emit = (event: AgentEvent) => {
      if (event.type === 'session' && event.sessionId && !turn.sessionId) {
        turn.sessionId = event.sessionId;
        this.sessions.set(event.sessionId, turn.id);
      }
      this.send(socket, { type: 'agent.event', turnId: turn.id, event });
    };

    turn.handle = this.runTurn({
      workspace: ws,
      sessionId: msg.sessionId,
      model: msg.model,
      text: msg.text,
      mcpEnv: { SSH_SERVER_INTERNAL_URL: this.deps.internalUrl(), SSH_SERVER_SESSION_TOKEN: token },
      emit,
      requestPermission: (req) =>
        new Promise<PermissionAnswer>((resolve) => this.pending.set(req.requestId, { turnId: turn.id, resolve })),
    });

    void turn.handle.done
      .catch((e: unknown) => this.send(socket, { type: 'error', turnId: turn.id, message: (e as Error).message }))
      .then(() => this.finish(turn, token));
  }

  private finish(turn: Turn, token: string): void {
    this.deps.registry.unregister(token);
    this.turns.delete(turn.id);
    if (turn.sessionId && this.sessions.get(turn.sessionId) === turn.id) this.sessions.delete(turn.sessionId);
    for (const [id, p] of this.pending) {
      if (p.turnId === turn.id) {
        this.pending.delete(id);
        p.resolve({ allow: false, message: '本轮已结束' });
      }
    }
    this.send(turn.socket, { type: 'turn.finished', turnId: turn.id });
  }
}
