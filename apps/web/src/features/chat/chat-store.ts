// 会话身份包含 Agent；历史请求与实时轮次分别校验选择代次和关联 ID。
import { create } from 'zustand';
import type { AgentKind, ServerMessage, SessionRef } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { queryClient } from '../../lib/query-client';
import { connectChat, type ChatSocket, type ConnectionStatus } from '../../lib/ws';
import { markPermissionPending, reduceChat, type ChatItem } from './chat-reducer';

const LAST_WORKSPACE_KEY = 'ssh-server.lastWorkspace';
type ChatState = {
  connection: ConnectionStatus;
  workspaceId?: string;
  agent: AgentKind;
  sessionId?: string;
  modelOverrides: Record<AgentKind, string>;
  reasoningEffort: string;
  actualModel?: string;
  items: ChatItem[];
  running: boolean;
  turnId?: string;
  pendingClientTurnId?: string;
  interruptRequested: boolean;
  loadingHistory: boolean;
  banner?: string;
  selectWorkspace(id: string): void;
  newSession(agent?: AgentKind): void;
  setAgent(agent: AgentKind): void;
  openSession(session: SessionRef): Promise<void>;
  setModel(model: string): void;
  setReasoningEffort(effort: string): void;
  send(text: string): boolean;
  interrupt(): void;
  respondPermission(requestId: string, allow: boolean): void;
  dismissBanner(): void;
};

let socket: ChatSocket | undefined;
let historyRequest: AbortController | undefined;
let selectionGeneration = 0;
const pendingInterrupts = new Set<string>();
const emptyConversation = {
  sessionId: undefined,
  actualModel: undefined,
  items: [] as ChatItem[],
  running: false,
  turnId: undefined,
  pendingClientTurnId: undefined,
  interruptRequested: false,
  loadingHistory: false,
  banner: undefined,
};
function changeSelection(): number {
  historyRequest?.abort();
  historyRequest = undefined;
  return ++selectionGeneration;
}
function historyIsCurrent(controller: AbortController, generation: number, workspaceId: string, session: SessionRef) {
  const current = useChat.getState();
  return (
    !controller.signal.aborted &&
    generation === selectionGeneration &&
    current.workspaceId === workspaceId &&
    current.agent === session.agent &&
    current.sessionId === session.sessionId
  );
}
export const lastWorkspaceId = () => localStorage.getItem(LAST_WORKSPACE_KEY) ?? undefined;

export const useChat = create<ChatState>()((set, get) => ({
  connection: 'connecting',
  agent: 'claude',
  modelOverrides: { claude: '', codex: '' },
  reasoningEffort: '',
  ...emptyConversation,
  selectWorkspace(id) {
    if (get().workspaceId === id) return;
    changeSelection();
    localStorage.setItem(LAST_WORKSPACE_KEY, id);
    set({ workspaceId: id, ...emptyConversation });
  },
  newSession(agent = get().agent) {
    changeSelection();
    set({ ...emptyConversation, agent });
  },
  setAgent(agent) {
    const current = get();
    if (current.sessionId || current.running || current.loadingHistory || current.pendingClientTurnId) return;
    if (current.agent !== agent) get().newSession(agent);
  },
  async openSession(session) {
    const { workspaceId } = get();
    if (!workspaceId) return;
    const generation = changeSelection();
    const controller = new AbortController();
    historyRequest = controller;
    set({ ...emptyConversation, agent: session.agent, sessionId: session.sessionId, loadingHistory: true });
    try {
      const history = await api.sessionEvents(workspaceId, session.sessionId, session.agent, controller.signal);
      if (!historyIsCurrent(controller, generation, workspaceId, session)) return;
      if (history.session.agent !== session.agent || history.session.sessionId !== session.sessionId)
        throw new Error('会话身份不匹配，未载入历史');
      const items = [...history.events, { type: 'turn_end', isError: false } as const].reduce(reduceChat, []);
      set({ items, loadingHistory: false, actualModel: history.actualModel });
    } catch (error) {
      if (historyIsCurrent(controller, generation, workspaceId, session))
        set({ loadingHistory: false, banner: `加载会话失败：${error instanceof Error ? error.message : '请重试'}` });
    } finally {
      if (historyRequest === controller) historyRequest = undefined;
    }
  },
  setModel: (model) => set((current) => ({ modelOverrides: { ...current.modelOverrides, [current.agent]: model } })),
  setReasoningEffort: (reasoningEffort) => set({ reasoningEffort }),
  send(text) {
    const current = get();
    if (!current.workspaceId || current.running || current.loadingHistory || !socket || !text.trim()) return false;
    const clientTurnId = crypto.randomUUID();
    const sent = socket.send({
      type: 'chat.send',
      workspaceId: current.workspaceId,
      agent: current.agent,
      sessionId: current.sessionId,
      text,
      model: current.modelOverrides[current.agent].trim() || undefined,
      reasoningEffort: current.agent === 'codex' ? current.reasoningEffort.trim() || undefined : undefined,
      clientTurnId,
    });
    if (!sent) {
      set({ banner: '连接已断开，消息未发送。请等待重新连接后再试。' });
      return false;
    }
    set((state) => ({
      items: reduceChat(state.items, { type: 'user_message', text }),
      running: true,
      pendingClientTurnId: clientTurnId,
      interruptRequested: false,
      banner: undefined,
    }));
    return true;
  },
  interrupt() {
    const current = get();
    if (!current.running || current.interruptRequested) return;
    if (current.turnId) {
      if (!socket?.send({ type: 'chat.interrupt', turnId: current.turnId })) return;
    } else if (current.pendingClientTurnId) pendingInterrupts.add(current.pendingClientTurnId);
    set({ interruptRequested: true });
  },
  respondPermission(requestId, allow) {
    const current = get();
    if (!canRespond(current, requestId)) return;
    if (!socket?.send({ type: 'permission.respond', turnId: current.turnId!, requestId, allow })) {
      set({ banner: '连接已断开，答复未发送。' });
      return;
    }
    set((state) => ({ items: markPermissionPending(state.items, requestId) }));
  },
  dismissBanner: () => set({ banner: undefined }),
}));

function canRespond(current: ChatState, requestId: string): boolean {
  if (!current.running || !current.turnId || current.interruptRequested || current.connection !== 'open') return false;
  return current.items.some(
    (item) => item.kind === 'permission' && item.id === requestId && !item.resolved && !item.responding,
  );
}
type Msg<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;
function onTurnStarted(msg: Msg<'turn.started'>): void {
  if (pendingInterrupts.delete(msg.clientTurnId)) socket?.send({ type: 'chat.interrupt', turnId: msg.turnId });
  const current = useChat.getState();
  if (
    msg.clientTurnId !== current.pendingClientTurnId ||
    msg.workspaceId !== current.workspaceId ||
    msg.agent !== current.agent
  )
    return;
  useChat.setState({ turnId: msg.turnId, pendingClientTurnId: undefined });
}
function onAgentEvent(msg: Msg<'agent.event'>): void {
  const current = useChat.getState();
  if (msg.turnId !== current.turnId) return;
  const event = msg.event;
  if (event.type === 'session' && event.agent && event.agent !== current.agent) return;
  if (event.type === 'session' && current.sessionId && current.sessionId !== event.sessionId) return;
  useChat.setState({
    items: reduceChat(current.items, event),
    ...(event.type === 'session' ? { sessionId: event.sessionId, actualModel: event.model } : {}),
  });
}
function onTurnFinished(msg: Msg<'turn.finished'>): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.sessions(msg.workspaceId, msg.agent) });
  const current = useChat.getState();
  if (msg.turnId !== current.turnId || msg.workspaceId !== current.workspaceId || msg.agent !== current.agent) return;
  useChat.setState({
    running: false,
    turnId: undefined,
    interruptRequested: false,
    items: reduceChat(current.items, { type: 'turn_end', isError: false }),
  });
}
function onError(msg: Msg<'error'>): void {
  const current = useChat.getState();
  if (msg.clientTurnId) pendingInterrupts.delete(msg.clientTurnId);
  if (msg.turnId && msg.turnId === current.turnId) {
    useChat.setState({ banner: msg.message });
    return;
  }
  if (!msg.clientTurnId || msg.clientTurnId !== current.pendingClientTurnId) return;
  useChat.setState({ banner: msg.message, running: false, pendingClientTurnId: undefined, interruptRequested: false });
}
function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'turn.started':
      return onTurnStarted(msg);
    case 'agent.event':
      return onAgentEvent(msg);
    case 'turn.finished':
      return onTurnFinished(msg);
    case 'error':
      return onError(msg);
  }
}
function handleStatus(status: ConnectionStatus): void {
  const current = useChat.getState();
  if (status !== 'open') pendingInterrupts.clear();
  if (status !== 'open' && current.running) {
    useChat.setState({
      running: false,
      turnId: undefined,
      pendingClientTurnId: undefined,
      interruptRequested: false,
      items: reduceChat(current.items, { type: 'turn_end', isError: true }),
      banner: '连接已断开，本轮输出可能不完整。重新连接后可从会话列表重新打开查看。',
    });
  }
  useChat.setState({ connection: status });
}
type Connect = typeof connectChat;
export function startChatConnection(connect: Connect = connectChat): void {
  socket ??= connect({ onMessage: handleServerMessage, onStatus: handleStatus });
}
export const reconnectChat = () => socket?.reconnect();
