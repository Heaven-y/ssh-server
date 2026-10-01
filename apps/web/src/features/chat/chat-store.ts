// 当前工作区与会话的对话状态；WebSocket 消息在这里转成界面条目
import { create } from 'zustand';
import type { ServerMessage } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { queryClient } from '../../lib/query-client';
import { connectChat, type ChatSocket, type ConnectionStatus } from '../../lib/ws';
import { reduceChat, resolvePermission, type ChatItem } from './chat-reducer';

const LAST_WORKSPACE_KEY = 'ssh-server.lastWorkspace';

type ChatState = {
  connection: ConnectionStatus;
  workspaceId?: string;
  /** 新会话在收到 session 事件前没有 id */
  sessionId?: string;
  /** 用户填写的模型，空字符串表示跟随本地配置 */
  model: string;
  /** Agent 实际使用的模型（来自 session 事件） */
  actualModel?: string;
  items: ChatItem[];
  running: boolean;
  turnId?: string;
  pendingClientTurnId?: string;
  loadingHistory: boolean;
  banner?: string;

  selectWorkspace(id: string): void;
  newSession(): void;
  openSession(sessionId: string): Promise<void>;
  setModel(model: string): void;
  send(text: string): void;
  interrupt(): void;
  respondPermission(requestId: string, allow: boolean): void;
  dismissBanner(): void;
};

let socket: ChatSocket | undefined;

/** 切换会话时清空的部分；进行中的轮次在后端继续运行，界面不再接收它的事件 */
const emptyConversation = {
  sessionId: undefined,
  actualModel: undefined,
  items: [] as ChatItem[],
  running: false,
  turnId: undefined,
  pendingClientTurnId: undefined,
  loadingHistory: false,
  banner: undefined,
};

export const lastWorkspaceId = () => localStorage.getItem(LAST_WORKSPACE_KEY) ?? undefined;

export const useChat = create<ChatState>()((set, get) => ({
  connection: 'connecting',
  model: '',
  ...emptyConversation,

  selectWorkspace(id) {
    if (get().workspaceId === id) return;
    localStorage.setItem(LAST_WORKSPACE_KEY, id);
    set({ workspaceId: id, ...emptyConversation });
  },

  newSession: () => set(emptyConversation),

  async openSession(sessionId) {
    const { workspaceId } = get();
    if (!workspaceId) return;
    set({ ...emptyConversation, sessionId, loadingHistory: true });
    try {
      const events = await api.sessionEvents(workspaceId, sessionId);
      if (get().sessionId !== sessionId) return; // 加载期间已切换到别的会话
      const items = [...events, { type: 'turn_end', isError: false } as const].reduce(reduceChat, []);
      const session = events.find((e) => e.type === 'session');
      set({ items, loadingHistory: false, actualModel: session?.model });
    } catch (e) {
      if (get().sessionId === sessionId) set({ loadingHistory: false, banner: `加载会话失败：${(e as Error).message}` });
    }
  },

  setModel: (model) => set({ model }),

  send(text) {
    const { workspaceId, sessionId, model, running } = get();
    if (!workspaceId || running || !socket) return;
    const clientTurnId = crypto.randomUUID();
    const sent = socket.send({
      type: 'chat.send',
      workspaceId,
      sessionId,
      text,
      model: model.trim() || undefined,
      clientTurnId,
    });
    if (!sent) {
      set({ banner: '连接已断开，消息未发送。请等待重新连接后再试。' });
      return;
    }
    set((s) => ({
      items: reduceChat(s.items, { type: 'user_message', text }),
      running: true,
      pendingClientTurnId: clientTurnId,
      banner: undefined,
    }));
  },

  interrupt() {
    const { turnId } = get();
    if (turnId) socket?.send({ type: 'chat.interrupt', turnId });
  },

  respondPermission(requestId, allow) {
    if (!socket?.send({ type: 'permission.respond', requestId, allow })) {
      set({ banner: '连接已断开，答复未发送。' });
      return;
    }
    set((s) => ({ items: resolvePermission(s.items, requestId, allow) }));
  },

  dismissBanner: () => set({ banner: undefined }),
}));

/** 处理后端消息：只接收当前界面这一轮的事件 */
function handleServerMessage(msg: ServerMessage): void {
  const s = useChat.getState();
  switch (msg.type) {
    case 'turn.started':
      if (msg.clientTurnId === s.pendingClientTurnId) useChat.setState({ turnId: msg.turnId, pendingClientTurnId: undefined });
      return;
    case 'agent.event': {
      if (msg.turnId !== s.turnId) return;
      const e = msg.event;
      useChat.setState({
        items: reduceChat(s.items, e),
        ...(e.type === 'session' ? { sessionId: e.sessionId, actualModel: e.model } : {}),
      });
      return;
    }
    case 'turn.finished':
      if (msg.turnId !== s.turnId) return;
      useChat.setState({ running: false, turnId: undefined, items: reduceChat(s.items, { type: 'turn_end', isError: false }) });
      if (s.workspaceId) void queryClient.invalidateQueries({ queryKey: queryKeys.sessions(s.workspaceId) });
      return;
    case 'error': {
      // 不带 turnId 的错误发生在轮次开始之前（如会话正在运行），此时结束等待状态
      const mine = msg.turnId ? msg.turnId === s.turnId : s.pendingClientTurnId !== undefined;
      if (!mine) return;
      useChat.setState({
        banner: msg.message,
        ...(msg.turnId ? {} : { running: false, pendingClientTurnId: undefined }),
      });
      return;
    }
  }
}

function handleStatus(status: ConnectionStatus): void {
  const { running } = useChat.getState();
  // 断线后本轮剩余事件不会补发，结束运行状态并提示用户
  if (status !== 'open' && running) {
    useChat.setState({
      running: false,
      turnId: undefined,
      pendingClientTurnId: undefined,
      banner: '连接已断开，本轮输出可能不完整。重新连接后可从会话列表重新打开查看。',
    });
  }
  useChat.setState({ connection: status });
}

/** 应用启动时调用一次 */
export function startChatConnection(): void {
  socket ??= connectChat({ onMessage: handleServerMessage, onStatus: handleStatus });
}

export const reconnectChat = () => socket?.reconnect();
