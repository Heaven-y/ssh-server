// 会话身份包含 Agent；历史请求与实时轮次分别校验选择代次和关联 ID。
import { create } from 'zustand';
import type {
  AgentKind,
  AgentCapability,
  AgentEvent,
  ContextUsage,
  CompactionState,
  ServerMessage,
  SessionActionInput,
  SessionRef,
  ProductSettings,
} from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { queryClient } from '../../lib/query-client';
import { connectChat, type ChatSocket, type ConnectionStatus } from '../../lib/ws';
import { markPermissionPending, reduceChat, type ChatItem } from './chat-reducer';
import { capabilityRestriction, selectionRestriction } from './capability-selection';

const LAST_WORKSPACE_KEY = 'ssh-server.lastWorkspace';
export type SessionOperation = { action: SessionActionInput['action']; pending: boolean; error?: string };
export const sessionActionKey = (workspaceId: string, session: SessionRef): string =>
  JSON.stringify([workspaceId, session.agent, session.sessionId]);
type ChatState = {
  connection: ConnectionStatus;
  workspaceId?: string;
  agent: AgentKind;
  sessionId?: string;
  modelOverrides: Record<AgentKind, string>;
  modelSources: Record<AgentKind, 'default' | 'explicit'>;
  defaults: Pick<ProductSettings, 'defaultAgent' | 'defaultModels'>;
  initialDefaultsEligible: boolean;
  reasoningEffort: string;
  actualModel?: string;
  selectedCapability?: AgentCapability;
  contextUsage?: ContextUsage | null;
  compaction?: CompactionState;
  items: ChatItem[];
  running: boolean;
  turnId?: string;
  pendingClientTurnId?: string;
  interruptRequested: boolean;
  loadingHistory: boolean;
  banner?: string;
  sessionOperations: Record<string, SessionOperation>;
  manageSession(workspaceId: string, session: SessionRef, input: SessionActionInput): Promise<boolean>;
  selectWorkspace(id?: string): void;
  removeWorkspace(id: string, nextId?: string): void;
  newSession(agent?: AgentKind): void;
  setAgent(agent: AgentKind): void;
  openSession(session: SessionRef): Promise<void>;
  setModel(model: string): void;
  setDefaults(settings: ProductSettings): void;
  touchDraft(): void;
  setReasoningEffort(effort: string): void;
  selectCapability(capability?: AgentCapability): void;
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
  selectedCapability: undefined,
  contextUsage: undefined,
  compaction: undefined,
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
function sameSession(current: ChatState, workspaceId: string, session: SessionRef): boolean {
  return (
    current.workspaceId === workspaceId && current.agent === session.agent && current.sessionId === session.sessionId
  );
}
export function managementPending(current: ChatState): boolean {
  if (!current.workspaceId || !current.sessionId) return false;
  return (
    current.sessionOperations[
      sessionActionKey(current.workspaceId, { agent: current.agent, sessionId: current.sessionId })
    ]?.pending === true
  );
}
function cannotSend(current: ChatState, text: string): boolean {
  return (
    current.running ||
    current.loadingHistory ||
    (!text.trim() && !current.selectedCapability) ||
    managementPending(current)
  );
}
function nativeStatus(event: AgentEvent): { contextUsage?: ContextUsage | null; compaction?: CompactionState } {
  if (event.type === 'context') return { contextUsage: event.usage };
  if (event.type === 'compaction') return { compaction: event.state };
  return {};
}
function newDefaults(current: ChatState) {
  return {
    agent: current.defaults.defaultAgent,
    modelOverrides: { ...current.defaults.defaultModels },
    modelSources: { claude: 'default', codex: 'default' } as const,
    reasoningEffort: '',
  };
}
function historicalModels(current: ChatState) {
  return Object.fromEntries(
    (['claude', 'codex'] as const).map((agent) => [
      agent,
      current.modelSources[agent] === 'explicit' ? current.modelOverrides[agent] : '',
    ]),
  ) as Record<AgentKind, string>;
}
export function lastWorkspaceId(): string | undefined {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function persistWorkspace(id?: string): void {
  try {
    if (id) localStorage.setItem(LAST_WORKSPACE_KEY, id);
    else localStorage.removeItem(LAST_WORKSPACE_KEY);
  } catch {
    /* 浏览器存储不可用时继续当前页面的内存选择。 */
  }
}

export const useChat = create<ChatState>()((set, get) => ({
  connection: 'connecting',
  agent: 'claude',
  modelOverrides: { claude: '', codex: '' },
  modelSources: { claude: 'default', codex: 'default' },
  defaults: { defaultAgent: 'claude', defaultModels: { claude: '', codex: '' } },
  initialDefaultsEligible: true,
  reasoningEffort: '',
  sessionOperations: {},
  ...emptyConversation,
  selectWorkspace(id) {
    if (get().workspaceId === id) return;
    changeSelection();
    persistWorkspace(id);
    set({ workspaceId: id, ...emptyConversation, ...newDefaults(get()) });
  },
  removeWorkspace(id, nextId) {
    const prefix = JSON.stringify([id]).slice(0, -1) + ',';
    const sessionOperations = Object.fromEntries(
      Object.entries(get().sessionOperations).filter(([key]) => !key.startsWith(prefix)),
    );
    if (lastWorkspaceId() === id) persistWorkspace();
    // 迟到的删除结果只清理所属状态，不能切走用户已经选择的其他工作区。
    if (get().workspaceId === id) get().selectWorkspace(nextId);
    set({ sessionOperations });
  },
  newSession(agent = get().defaults.defaultAgent) {
    changeSelection();
    set({ ...emptyConversation, ...newDefaults(get()), agent, initialDefaultsEligible: false });
  },
  setAgent(agent) {
    const current = get();
    if (current.sessionId || current.running || current.loadingHistory || current.pendingClientTurnId) return;
    set({ initialDefaultsEligible: false });
    if (current.agent !== agent) {
      changeSelection();
      set({ ...emptyConversation, agent });
    }
  },
  async openSession(session) {
    const { workspaceId } = get();
    if (!workspaceId) return;
    const generation = changeSelection();
    const controller = new AbortController();
    historyRequest = controller;
    set({
      ...emptyConversation,
      agent: session.agent,
      sessionId: session.sessionId,
      loadingHistory: true,
      modelOverrides: historicalModels(get()),
      initialDefaultsEligible: false,
    });
    try {
      const history = await api.sessionEvents(workspaceId, session.sessionId, session.agent, controller.signal);
      if (!historyIsCurrent(controller, generation, workspaceId, session)) return;
      if (history.session.agent !== session.agent || history.session.sessionId !== session.sessionId)
        throw new Error('会话身份不匹配，未载入历史');
      const items = [...history.events, { type: 'turn_end', isError: false } as const].reduce(reduceChat, []);
      const statuses = history.events.reduce((result, event) => ({ ...result, ...nativeStatus(event) }), {});
      set({ items, loadingHistory: false, actualModel: history.actualModel, ...statuses });
    } catch (error) {
      if (historyIsCurrent(controller, generation, workspaceId, session))
        set({ loadingHistory: false, banner: `加载会话失败：${error instanceof Error ? error.message : '请重试'}` });
    } finally {
      if (historyRequest === controller) historyRequest = undefined;
    }
  },
  setDefaults(settings) {
    const current = get();
    const defaults = { defaultAgent: settings.defaultAgent, defaultModels: { ...settings.defaultModels } };
    set({ defaults });
    if (
      current.initialDefaultsEligible &&
      !current.sessionId &&
      !current.running &&
      !current.loadingHistory &&
      !current.pendingClientTurnId &&
      !current.items.length
    ) {
      set({ ...newDefaults(get()), initialDefaultsEligible: false });
    }
  },
  touchDraft: () => set({ initialDefaultsEligible: false }),
  setModel: (model) =>
    set((current) => ({
      modelOverrides: { ...current.modelOverrides, [current.agent]: model },
      modelSources: { ...current.modelSources, [current.agent]: 'explicit' },
      initialDefaultsEligible: false,
    })),
  setReasoningEffort: (reasoningEffort) => set({ reasoningEffort, initialDefaultsEligible: false }),
  selectCapability(capability) {
    const current = get();
    if (current.running || current.loadingHistory || managementPending(current)) return;
    if (capability && capabilityRestriction(capability, current.sessionId)) return;
    set({ selectedCapability: capability, initialDefaultsEligible: false });
  },
  async manageSession(workspaceId, session, input) {
    const key = sessionActionKey(workspaceId, session);
    const current = get();
    if (current.sessionOperations[key]?.pending) return false;
    if (sameSession(current, workspaceId, session) && current.running) {
      set({
        sessionOperations: {
          ...current.sessionOperations,
          [key]: { action: input.action, pending: false, error: '会话正在运行，请结束后再管理' },
        },
      });
      return false;
    }
    set({ sessionOperations: { ...current.sessionOperations, [key]: { action: input.action, pending: true } } });
    try {
      await api.sessionAction(workspaceId, session.sessionId, session.agent, input);
      if ((input.action === 'delete' || input.action === 'archive') && sameSession(get(), workspaceId, session)) {
        changeSelection();
        set(emptyConversation);
      }
      const operations = { ...get().sessionOperations };
      delete operations[key];
      set({ sessionOperations: operations });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions(workspaceId, session.agent) });
      return true;
    } catch (error) {
      set((latest) => ({
        sessionOperations: {
          ...latest.sessionOperations,
          [key]: {
            action: input.action,
            pending: false,
            error: error instanceof Error ? error.message : '会话操作未确认，请重新读取列表核对',
          },
        },
      }));
      return false;
    }
  },
  send(text) {
    const current = get();
    if (!current.workspaceId || !socket || cannotSend(current, text)) return false;
    const restriction = selectionRestriction(current.selectedCapability, current.sessionId, text);
    if (restriction) {
      set({ banner: restriction });
      return false;
    }
    const clientTurnId = crypto.randomUUID();
    const sent = socket.send({
      type: 'chat.send',
      workspaceId: current.workspaceId,
      agent: current.agent,
      sessionId: current.sessionId,
      text,
      ...(current.selectedCapability ? { selection: { id: current.selectedCapability.id } } : {}),
      model: current.modelOverrides[current.agent].trim() || undefined,
      reasoningEffort: current.agent === 'codex' ? current.reasoningEffort.trim() || undefined : undefined,
      clientTurnId,
    });
    if (!sent) {
      set({ banner: '连接已断开，消息未发送。请等待重新连接后再试。' });
      return false;
    }
    set((state) => ({
      items: reduceChat(state.items, {
        type: 'user_message',
        text: current.selectedCapability ? `/${current.selectedCapability.name}${text ? ` ${text}` : ''}` : text,
      }),
      selectedCapability: undefined,
      // 旧轮次未确认的压缩留在历史中，新轮次不能把它重新显示为进行中。
      compaction: state.compaction?.status === 'running' ? undefined : state.compaction,
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
    ...nativeStatus(event),
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
