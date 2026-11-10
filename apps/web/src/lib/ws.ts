// 对话 WebSocket：partysocket 负责重连，恢复握手和事件游标禁止重复执行输入。
import { WebSocket as ReconnectingWebSocket } from 'partysocket';
import { claimRecoveryIdentity } from './chat-recovery-identity';
import type {
  ClientMessage,
  ServerMessage,
  RecoveryNotice,
  RecoveryServerMessage,
} from '@agentdeck/shared/conversation';
export type ConnectionStatus = 'connecting' | 'open' | 'closed';
export type ChatSocket = { send(msg: ClientMessage): boolean; reconnect(): void; close(): void };
type Handlers = {
  onMessage(msg: ServerMessage): void;
  onStatus(status: ConnectionStatus): void;
  onRecovery?(notice: RecoveryNotice): void;
};
const RECONNECT = { minReconnectionDelay: 1000, reconnectionDelayGrowFactor: 2, maxReconnectionDelay: 15_000 };
export function connectChat(handlers: Handlers): ChatSocket {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const ws = new ReconnectingWebSocket(url, [], { ...RECONNECT, maxEnqueuedMessages: 0, startClosed: true });
  const instanceId = crypto.randomUUID();
  let identity = { token: '', create: true };
  let releaseIdentity = () => undefined as void;
  let disposed = false;
  let identityGeneration = 0;
  let sequence = 0;
  let rebuild = true;
  let ready = false;
  let accepting = false;
  let capacityBlocked = false;
  let ownerRetryUntil = 0;
  let ownerRetry: ReturnType<typeof setTimeout> | undefined;
  let offline: ReturnType<typeof setTimeout> | undefined;
  let handshake: ReturnType<typeof setTimeout> | undefined;
  async function activateIdentity(fresh: boolean) {
    const generation = ++identityGeneration;
    releaseIdentity();
    const lease = await claimRecoveryIdentity(fresh);
    if (disposed || generation !== identityGeneration) {
      lease.release();
      return;
    }
    identity = lease.identity;
    releaseIdentity = lease.release;
    ws.reconnect();
  }
  function failed(notice: Extract<RecoveryNotice, { type: 'connection.rejected' }>) {
    ready = false;
    accepting = false;
    clearTimeout(handshake);
    clearTimeout(ownerRetry);
    if (notice.code === 'owner_connected') {
      ownerRetryUntil ||= Date.now() + 5000;
      if (Date.now() < ownerRetryUntil) {
        // 刷新文档已释放本机锁，但旧 TCP 的关闭可能晚于新握手。
        ownerRetry = setTimeout(() => ws.reconnect(), 1000);
        return;
      }
    }
    ownerRetryUntil = 0;
    clearTimeout(offline);
    offline = undefined;
    handlers.onRecovery?.(notice);
    sequence = 0;
    rebuild = true;
    if (notice.code === 'capacity') {
      capacityBlocked = true;
      ws.close();
      handlers.onStatus('closed');
      return;
    }
    void activateIdentity(true);
  }
  function disconnected() {
    accepting = false;
    ready = false;
    clearTimeout(handshake);
    handlers.onStatus(ws.shouldReconnect ? 'connecting' : 'closed');
    if (disposed || capacityBlocked) return;
    offline ??= setTimeout(() => {
      failed({
        type: 'connection.rejected',
        code: 'owner_missing',
        message: '连接长时间未恢复，本轮已超出保留期限。请重新读取原生历史；消息不会自动重发。',
      });
    }, 95_000);
  }
  function receiveEvent(message: Extract<RecoveryServerMessage, { type: 'connection.event' }>) {
    if (!Number.isSafeInteger(message.sequence) || message.sequence <= sequence) return;
    if (!rebuild && message.sequence !== sequence + 1) {
      ws.reconnect();
      return;
    }
    handlers.onMessage(message.message);
    sequence = message.sequence;
  }
  function recovered(message: Extract<RecoveryNotice, { type: 'connection.ready' }>) {
    if (!Number.isSafeInteger(message.sequence) || message.sequence < sequence) return;
    if (!rebuild && message.sequence !== sequence) {
      ws.reconnect();
      return;
    }
    sequence = message.sequence;
    rebuild = false;
    identity.create = false;
    ready = true;
    ownerRetryUntil = 0;
    clearTimeout(ownerRetry);
    clearTimeout(handshake);
    clearTimeout(offline);
    offline = undefined;
    handlers.onRecovery?.(message);
    handlers.onStatus('open');
  }
  function received(message: RecoveryServerMessage) {
    if (!accepting) return;
    switch (message.type) {
      case 'connection.snapshot':
        if (rebuild) handlers.onRecovery?.(message);
        return;
      case 'connection.event':
        return receiveEvent(message);
      case 'connection.ready':
        return recovered(message);
      case 'connection.rejected':
        failed(message);
    }
  }
  handlers.onStatus('connecting');
  void activateIdentity(false);
  ws.addEventListener('open', () => {
    accepting = true;
    ready = false;
    ws.send(JSON.stringify({ type: 'connection.resume', ...identity, instanceId, rebuild, afterSequence: sequence }));
    handshake = setTimeout(() => ws.reconnect(), 10_000);
  });
  ws.addEventListener('close', disconnected);
  ws.addEventListener('message', (event: MessageEvent) => {
    try {
      received(JSON.parse(String(event.data)) as RecoveryServerMessage);
    } catch {
      /* 异常帧不会推进游标。 */
    }
  });
  return {
    send(message) {
      if (!ready || ws.readyState !== ws.OPEN) return false;
      ws.send(JSON.stringify(message));
      return true;
    },
    reconnect() {
      if (disposed) return;
      if (capacityBlocked) {
        capacityBlocked = false;
        void activateIdentity(true);
      } else ws.reconnect();
    },
    close() {
      disposed = true;
      identityGeneration++;
      releaseIdentity();
      ws.close();
      clearTimeout(handshake);
      clearTimeout(offline);
      clearTimeout(ownerRetry);
    },
  };
}
