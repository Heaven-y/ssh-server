// 轮次按 Agent 与原生会话隔离；耗时准备前先建立应用轮次，允许及时中断。
import { randomUUID } from 'node:crypto';
import type { AgentEvent, AgentKind, ClientMessage, ServerMessage, SessionRef, Workspace } from '@ssh-server/shared';
import { runClaudeTurn } from '../agents/claude-adapter';
import type { AgentTurnInput, PermissionAnswer, TurnHandle, TurnRunner } from '../agents/types';
import type { SessionRegistry } from './registry';
import { SessionError, type SessionsService } from './sessions';
import type { CapabilitiesService } from './capabilities';
import type { SyncManager } from '../sync/manager';
import { WorkspaceRemovalError } from '../workspaces/activity';

export type Socket = { send(msg: ServerMessage): void; isOpen(): boolean };
export type TurnManagerDeps = {
  getWorkspace(id: string): Promise<Workspace | undefined>;
  registry: SessionRegistry;
  internalUrl(): string;
  runTurn?: TurnRunner;
  runners?: Partial<Record<AgentKind, TurnRunner>>;
  sessions: Pick<SessionsService, 'assertBelongs'>;
  capabilities?: Pick<CapabilitiesService, 'prepare'>;
  sync: Pick<SyncManager, 'sync'>;
  acquireWorkspace?: (id: string) => () => void;
};
type Turn = {
  id: string;
  socket: Socket;
  workspaceId: string;
  agent: AgentKind;
  controller: AbortController;
  handle?: TurnHandle;
  sessionId?: string;
  workspace?: Workspace;
  token?: string;
  finished: boolean;
  syncAfter?: boolean;
  releaseWorkspace?: () => void;
};
type Pending = { turn: Turn; resolve(answer: PermissionAnswer): void };
type Send = Extract<ClientMessage, { type: 'chat.send' }>;
const sessionKey = (agent: AgentKind, id: string) => `${agent}:${id}`;

/** 中断停止等待，同时消费仍在退出的元数据请求，避免未处理拒绝。 */
function preparing<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('本轮已中断'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export class TurnManager {
  private turns = new Map<string, Turn>();
  private sessions = new Map<string, string>();
  private pending = new Map<string, Pending>();
  private closed = new WeakSet<Socket>();
  private stopping = false;
  private readonly runners: Partial<Record<AgentKind, TurnRunner>>;

  constructor(private readonly deps: TurnManagerDeps) {
    this.runners = { claude: deps.runTurn ?? runClaudeTurn, ...deps.runners };
  }

  /** 原生管理从范围校验到写入结果全程占锁，避免与准备、运行及同步收尾交错。 */
  async withIdleSession<T>(session: SessionRef, operation: () => Promise<T>): Promise<T> {
    if (this.stopping) throw new SessionError(503, 'server_stopping', '后端正在关闭，请稍后重试');
    const key = sessionKey(session.agent, session.sessionId);
    if (this.sessions.has(key)) throw new SessionError(409, 'session_busy', '会话正在运行或处理其他操作，请稍后重试');
    const owner = randomUUID();
    this.sessions.set(key, owner);
    try {
      return await operation();
    } finally {
      if (this.sessions.get(key) === owner) this.sessions.delete(key);
    }
  }

  async handle(socket: Socket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'chat.send':
        return this.start(socket, msg);
      case 'chat.interrupt': {
        const turn = this.turns.get(msg.turnId);
        if (!turn || turn.socket !== socket) return;
        turn.controller.abort();
        await turn.handle?.interrupt();
        return;
      }
      case 'permission.respond':
        return this.respond(socket, msg);
    }
  }

  socketClosed(socket: Socket): void {
    this.closed.add(socket);
    for (const [id, pending] of this.pending) {
      if (pending.turn.socket === socket) {
        this.pending.delete(id);
        pending.resolve({ allow: false, message: '网页连接已断开' });
      }
    }
  }

  /** 退出后端时停止本进程拥有的轮次，并立即撤销内部工具令牌。 */
  async dispose(): Promise<void> {
    this.stopping = true;
    const handles: TurnHandle[] = [];
    for (const turn of this.turns.values()) {
      this.closed.add(turn.socket);
      turn.controller.abort();
      if (turn.token) this.deps.registry.unregister(turn.token);
      if (turn.handle) handles.push(turn.handle);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = Promise.allSettled(handles.flatMap((handle) => [handle.interrupt(), handle.done]));
    try {
      await Promise.race([
        stopped,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 6000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private send(socket: Socket, msg: ServerMessage): void {
    if (!this.closed.has(socket) && socket.isOpen()) socket.send(msg);
  }

  private respond(socket: Socket, msg: Extract<ClientMessage, { type: 'permission.respond' }>): void {
    const pending = this.pending.get(msg.requestId);
    if (!pending || pending.turn.id !== msg.turnId || pending.turn.socket !== socket) return;
    if (pending.turn.controller.signal.aborted) return;
    this.pending.delete(msg.requestId);
    pending.resolve({ allow: msg.allow, message: msg.message });
  }

  private bindSession(turn: Turn, id: string): boolean {
    const key = sessionKey(turn.agent, id);
    const occupied = this.sessions.get(key);
    if ((turn.sessionId && turn.sessionId !== id) || (occupied && occupied !== turn.id)) {
      this.send(turn.socket, { type: 'error', turnId: turn.id, message: '原生会话身份发生变化，已停止本轮' });
      turn.controller.abort();
      void turn.handle?.interrupt().catch(() => undefined);
      return false;
    }
    turn.sessionId = id;
    this.sessions.set(key, turn.id);
    return true;
  }

  private event(turn: Turn, event: AgentEvent): void {
    if (turn.finished) return;
    if (event.type === 'session') {
      if (!this.bindSession(turn, event.sessionId)) return;
      event = { ...event, agent: turn.agent };
    }
    if (event.type === 'permission_resolved') {
      const pending = this.pending.get(event.requestId);
      if (pending?.turn === turn) {
        this.pending.delete(event.requestId);
        pending.resolve({ allow: false, message: '原生确认请求已结束' });
      }
    }
    this.send(turn.socket, { type: 'agent.event', turnId: turn.id, event });
  }

  private permission(turn: Turn, req: Parameters<AgentTurnInput['requestPermission']>[0]): Promise<PermissionAnswer> {
    if (turn.controller.signal.aborted || turn.finished || this.closed.has(turn.socket))
      return Promise.resolve({ allow: false, message: '本轮或连接已结束' });
    return new Promise((resolve) => this.pending.set(req.requestId, { turn, resolve }));
  }

  private acquireWorkspace(socket: Socket, msg: Send): { release?: () => void } | undefined {
    try {
      return { release: this.deps.acquireWorkspace?.(msg.workspaceId) };
    } catch (error) {
      this.send(socket, {
        type: 'error',
        clientTurnId: msg.clientTurnId,
        message: error instanceof WorkspaceRemovalError ? error.message : '工作区当前不可用，请刷新后重试',
      });
      return;
    }
  }

  private preparationFailed(turn: Turn, error: unknown) {
    if (!turn.controller.signal.aborted)
      this.send(turn.socket, {
        type: 'error',
        turnId: turn.id,
        message: error instanceof SessionError ? error.message : 'Agent 调用失败，请检查本机运行时和配置',
      });
  }

  private async start(socket: Socket, msg: Send): Promise<void> {
    if (this.stopping) {
      this.send(socket, { type: 'error', clientTurnId: msg.clientTurnId, message: '后端正在关闭，请稍后重试' });
      return;
    }
    const agent = msg.agent ?? 'claude';
    const key = msg.sessionId && sessionKey(agent, msg.sessionId);
    if (key && this.sessions.has(key)) {
      this.send(socket, { type: 'error', clientTurnId: msg.clientTurnId, message: '该会话正在运行' });
      return;
    }
    const lease = this.acquireWorkspace(socket, msg);
    if (!lease) return;
    const turn: Turn = {
      id: randomUUID(),
      socket,
      agent,
      workspaceId: msg.workspaceId,
      sessionId: msg.sessionId,
      controller: new AbortController(),
      finished: false,
      releaseWorkspace: lease.release,
    };
    this.turns.set(turn.id, turn);
    if (key) this.sessions.set(key, turn.id);
    this.send(socket, {
      type: 'turn.started',
      turnId: turn.id,
      clientTurnId: msg.clientTurnId,
      workspaceId: msg.workspaceId,
      agent,
    });
    try {
      await this.prepare(turn, msg);
    } catch (error) {
      this.preparationFailed(turn, error);
      await this.finish(turn);
    }
  }

  private async prepare(turn: Turn, msg: Send): Promise<void> {
    const { signal } = turn.controller;
    const ws = await preparing(this.deps.getWorkspace(msg.workspaceId), signal);
    if (!ws) throw new SessionError(404, 'workspace_missing', '工作区不存在');
    turn.workspace = ws;
    if (msg.sessionId) await preparing(this.deps.sessions.assertBelongs(ws, turn.agent, msg.sessionId, signal), signal);
    if (msg.selection && !this.deps.capabilities)
      throw new SessionError(503, 'capabilities_unavailable', '当前原生能力不可用');
    const prepared = this.deps.capabilities
      ? await preparing(this.deps.capabilities.prepare(ws, turn.agent, msg, signal), signal)
      : { text: msg.text, invocation: undefined };
    signal.throwIfAborted();
    const runner = this.runners[turn.agent];
    if (!runner) throw new SessionError(503, 'agent_unavailable', '当前 Agent 适配器不可用');
    turn.token = this.deps.registry.register(ws.id);
    // 纯上下文查询/压缩不编辑项目文件，也不触发服务器同步。
    turn.syncAfter = prepared.invocation?.kind !== 'command';
    turn.handle = runner({
      workspace: ws,
      sessionId: msg.sessionId,
      model: msg.model,
      reasoningEffort: turn.agent === 'codex' ? msg.reasoningEffort : undefined,
      text: prepared.text,
      invocation: prepared.invocation,
      mcpEnv: { SSH_SERVER_INTERNAL_URL: this.deps.internalUrl(), SSH_SERVER_SESSION_TOKEN: turn.token },
      emit: (event) => this.event(turn, event),
      requestPermission: (req) => this.permission(turn, req),
    });
    if (signal.aborted) void turn.handle.interrupt();
    void turn.handle.done
      .catch(() => {
        this.send(turn.socket, { type: 'error', turnId: turn.id, message: 'Agent 运行失败，请检查本机运行时和配置' });
      })
      .then(() => this.finish(turn));
  }

  private async synchronize(turn: Turn): Promise<void> {
    if (!turn.handle || !turn.workspace || turn.syncAfter === false) return;
    try {
      const status = await this.deps.sync.sync(turn.workspace);
      if (status.phase !== 'ready')
        this.send(turn.socket, {
          type: 'error',
          turnId: turn.id,
          message: status.message ?? '同步尚未就绪，请在同步面板处理后继续',
        });
    } catch {
      this.send(turn.socket, { type: 'error', turnId: turn.id, message: '本轮结束后同步失败，请检查同步面板' });
    }
  }

  private async finish(turn: Turn): Promise<void> {
    if (turn.finished) return;
    turn.finished = true;
    if (turn.token) this.deps.registry.unregister(turn.token);
    for (const [id, pending] of this.pending) {
      if (pending.turn === turn) {
        this.pending.delete(id);
        pending.resolve({ allow: false, message: '本轮已结束' });
      }
    }
    try {
      await this.synchronize(turn);
    } finally {
      this.turns.delete(turn.id);
      const key = turn.sessionId && sessionKey(turn.agent, turn.sessionId);
      if (key && this.sessions.get(key) === turn.id) this.sessions.delete(key);
      turn.releaseWorkspace?.();
      this.send(turn.socket, {
        type: 'turn.finished',
        turnId: turn.id,
        workspaceId: turn.workspaceId,
        agent: turn.agent,
      });
    }
  }
}
