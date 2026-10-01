// 对话 WebSocket：断线重连交给 partysocket，这里只做消息编解码与连接状态
import { WebSocket as ReconnectingWebSocket } from 'partysocket';
import type { ClientMessage, ServerMessage } from '@ssh-server/shared';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export type ChatSocket = {
  send(msg: ClientMessage): boolean;
  reconnect(): void;
  close(): void;
};

/** 重连间隔 1、2、4、8 秒……上限 15 秒（设计文档第 12 节） */
const RECONNECT = { minReconnectionDelay: 1000, reconnectionDelayGrowFactor: 2, maxReconnectionDelay: 15_000 };

export function connectChat(handlers: {
  onMessage(msg: ServerMessage): void;
  onStatus(status: ConnectionStatus): void;
}): ChatSocket {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  // 发送缓冲设为 0：断线时的消息直接丢弃并告知调用方，避免重连后重复发送对话
  const ws = new ReconnectingWebSocket(url, [], { ...RECONNECT, maxEnqueuedMessages: 0 });

  handlers.onStatus('connecting');
  ws.addEventListener('open', () => handlers.onStatus('open'));
  ws.addEventListener('close', () => handlers.onStatus(ws.shouldReconnect ? 'connecting' : 'closed'));
  ws.addEventListener('message', (e: MessageEvent) => {
    try {
      handlers.onMessage(JSON.parse(String(e.data)) as ServerMessage);
    } catch {
      // 非法消息直接忽略
    }
  });

  return {
    send(msg) {
      if (ws.readyState !== ws.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    reconnect: () => ws.reconnect(),
    close: () => ws.close(),
  };
}
