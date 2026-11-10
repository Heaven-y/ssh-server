import type {
  ClientMessage,
  RecoveryFailureCode,
  RecoveryNotice,
  ResumeRequest,
  ServerMessage,
  RecoveryTurn,
} from '@agentdeck/shared/conversation';
import type { Socket, TurnManager } from './turn-manager';

export type ResumePeer = { send(data: string): void; isOpen(): boolean; close?(): void };
export type ResumeLimits = {
  offlineMs: number;
  completedMs: number;
  ownerBytes: number;
  totalBytes: number;
  owners: number;
};
const DEFAULT_LIMITS: ResumeLimits = {
  offlineMs: 60_000,
  completedMs: 300_000,
  ownerBytes: 16 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  owners: 64,
};
type SavedTurn = RecoveryTurn & { bytes: number; turnId?: string; completedAt?: number };
type SavedEvent = { sequence: number; data: string; bytes: number; clientTurnId?: string };
type Owner = {
  token: string;
  socket: Socket;
  peer?: ResumePeer;
  instanceId?: string;
  offlineAt?: number;
  sequence: number;
  floor: number;
  bytes: number;
  turns: Map<string, SavedTurn>;
  events: SavedEvent[];
};
const messages: Record<RecoveryFailureCode, string> = {
  owner_missing: '恢复记录已过期或后端已重启。本轮输出可能不完整，请重新读取原生历史；消息不会自动重发。',
  owner_connected: '此恢复身份正在另一页面使用，不能接管其回合。此页面将使用新的连接身份。',
  cache_expired: '恢复缓存已过期，无法完整补收。请重新读取原生历史；消息不会自动重发。',
  capacity: '恢复缓存已达到上限，已停止此连接的回合。请重新读取原生历史；消息不会自动重发。',
  server_closed: '后端已关闭，本轮已停止。请重新读取原生历史。',
};
const sizeOf = (data: string) => data.length * 2 + 128;
function messageClientId(owner: Owner, message: ServerMessage): string | undefined {
  if ('clientTurnId' in message && message.clientTurnId) return message.clientTurnId;
  if (!('turnId' in message) || !message.turnId) return;
  return [...owner.turns].find(([, turn]) => turn.turnId === message.turnId)?.[0];
}
function recordTurn(owner: Owner, message: ServerMessage): string | undefined {
  const id = messageClientId(owner, message);
  const turn = id ? owner.turns.get(id) : undefined;
  if (!turn) return id;
  if (message.type === 'turn.started') turn.turnId = message.turnId;
  if (message.type === 'turn.finished' || (message.type === 'error' && !message.turnId)) turn.completedAt = Date.now();
  return id;
}

/** 运行器只持有稳定代理；短暂离线时代理仍可接收输出和审批。 */
export class ResumeHub {
  private owners = new Map<string, Owner>();
  private totalBytes = 0;
  private closed = false;
  private timer: ReturnType<typeof setInterval>;
  private limits: ResumeLimits;

  constructor(
    private turns: Pick<TurnManager, 'handle' | 'socketClosed'>,
    limits: Partial<ResumeLimits> = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.timer = setInterval(() => this.prune(), Math.min(this.limits.offlineMs, this.limits.completedMs, 1000));
    this.timer.unref();
  }

  attach(peer: ResumePeer, request: ResumeRequest): Socket | undefined {
    this.prune();
    if (this.closed) return this.reject(peer, 'server_closed');
    const owner = this.findOwner(peer, request);
    if (!owner) return;
    if (request.afterSequence > owner.sequence || (!request.rebuild && request.afterSequence < owner.floor)) {
      this.remove(owner);
      return this.reject(peer, 'cache_expired');
    }
    this.replacePeer(owner, peer, request.instanceId);
    if (request.rebuild)
      this.notify(peer, {
        type: 'connection.snapshot',
        turns: [...owner.turns.values()].map(({ message, sentAt }) => ({ message, sentAt })),
      });
    for (const event of owner.events) {
      if (request.rebuild || event.sequence > request.afterSequence) peer.send(event.data);
    }
    this.notify(peer, {
      type: 'connection.ready',
      sequence: owner.sequence,
      acceptedClientTurnIds: [...owner.turns.keys()],
    });
    return owner.socket;
  }

  private replacePeer(owner: Owner, peer: ResumePeer, instanceId?: string): void {
    owner.peer?.close?.();
    owner.peer = peer;
    owner.instanceId = instanceId;
    owner.offlineAt = undefined;
  }

  private findOwner(peer: ResumePeer, request: ResumeRequest): Owner | undefined {
    const owner = this.owners.get(request.token);
    if (owner) {
      const sameDocument = request.instanceId !== undefined && owner.instanceId === request.instanceId;
      if (owner.peer?.isOpen() && !sameDocument) return this.reject(peer, 'owner_connected');
      return owner;
    }
    if (!request.create) return this.reject(peer, 'owner_missing');
    if (this.owners.size >= this.limits.owners) return this.reject(peer, 'capacity');
    return this.createOwner(request.token);
  }

  async handle(peer: ResumePeer, socket: Socket, message: ClientMessage): Promise<void> {
    const owner = [...this.owners.values()].find((entry) => entry.socket === socket);
    if (!owner || owner.peer !== peer) return;
    if (message.type === 'chat.send') {
      // 重复发送标识只接收一次，恢复从不重新执行用户输入。
      if (owner.turns.has(message.clientTurnId)) return;
      this.prune();
      const saved = { message, sentAt: Date.now(), bytes: sizeOf(JSON.stringify(message)) };
      if (!this.reserve(owner, saved.bytes)) return;
      owner.turns.set(message.clientTurnId, saved);
    }
    await this.turns.handle(socket, message);
  }

  detach(peer: ResumePeer, socket: Socket): void {
    const owner = [...this.owners.values()].find((entry) => entry.socket === socket);
    if (!owner || owner.peer !== peer) return;
    owner.peer = undefined;
    owner.offlineAt = Date.now();
  }

  dispose(): void {
    this.closed = true;
    clearInterval(this.timer);
    for (const owner of this.owners.values()) this.remove(owner, 'server_closed');
  }

  private createOwner(token: string): Owner {
    const owner: Owner = {
      token,
      socket: { send: (message) => this.publish(owner, message), isOpen: () => this.owners.has(token) },
      sequence: 0,
      floor: 0,
      bytes: 0,
      turns: new Map(),
      events: [],
    };
    this.owners.set(token, owner);
    return owner;
  }

  private publish(owner: Owner, message: ServerMessage): void {
    if (this.owners.get(owner.token) !== owner) return;
    const clientTurnId = recordTurn(owner, message);
    const sequence = owner.sequence + 1;
    const data = JSON.stringify({ type: 'connection.event', sequence, message });
    const bytes = sizeOf(data);
    if (!this.reserve(owner, bytes)) return;
    owner.sequence = sequence;
    owner.events.push({ sequence, data, bytes, clientTurnId });
    if (owner.peer?.isOpen()) owner.peer.send(data);
  }

  private reserve(owner: Owner, bytes: number): boolean {
    if (owner.bytes + bytes > this.limits.ownerBytes || this.totalBytes + bytes > this.limits.totalBytes) {
      this.remove(owner, 'capacity');
      return false;
    }
    owner.bytes += bytes;
    this.totalBytes += bytes;
    return true;
  }

  private prune(): void {
    const now = Date.now();
    for (const owner of this.owners.values()) {
      if (owner.offlineAt !== undefined && now - owner.offlineAt >= this.limits.offlineMs) {
        this.remove(owner);
        continue;
      }
      const expired = new Set(
        [...owner.turns]
          .filter(([, turn]) => turn.completedAt !== undefined && now - turn.completedAt >= this.limits.completedMs)
          .map(([id]) => id),
      );
      for (const id of expired) {
        const turn = owner.turns.get(id)!;
        owner.bytes -= turn.bytes;
        this.totalBytes -= turn.bytes;
        owner.turns.delete(id);
      }
      owner.events = owner.events.filter((event) => {
        if (!event.clientTurnId || !expired.has(event.clientTurnId)) return true;
        owner.bytes -= event.bytes;
        this.totalBytes -= event.bytes;
        owner.floor = Math.max(owner.floor, event.sequence);
        return false;
      });
    }
  }

  private remove(owner: Owner, code?: RecoveryFailureCode): void {
    this.owners.delete(owner.token);
    this.totalBytes -= owner.bytes;
    if (code && owner.peer?.isOpen()) this.reject(owner.peer, code);
    this.turns.socketClosed(owner.socket);
  }
  private notify(peer: ResumePeer, message: RecoveryNotice): void {
    if (peer.isOpen()) peer.send(JSON.stringify(message));
  }
  private reject(peer: ResumePeer, code: RecoveryFailureCode): undefined {
    this.notify(peer, { type: 'connection.rejected', code, message: messages[code] });
    return undefined;
  }
}
