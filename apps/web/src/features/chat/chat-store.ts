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
} from '@agentdeck/shared';
import { api, ApiError } from '../../lib/api';
import { refreshSessionLists } from '../sessions/session-queries';
import { connectChat, type ChatSocket, type ConnectionStatus } from '../../lib/ws';
import { markPermissionPending, reduceChat, type ChatItem } from './chat-reducer';
import { capabilityRestriction, selectionRestriction } from './capability-selection';

const LAST_WORKSPACE_KEY = 'agentdeck.lastProject';
const DEFAULT_REASONING_EFFORTS: Record<AgentKind, string> = {
  claude: '',
  codex: '',
  antigravity: '',
};
/** 未显式选择的模型和强度都由原生配置决定。 */
const EMPTY_MODEL_OVERRIDES: Record<AgentKind, string> = { claude: '', codex: '', antigravity: '' };
export type SessionOperation = { action: SessionActionInput['action'] | 'fork'; pending: boolean; error?: string };
export const sessionActionKey = (workspaceId: string, session: SessionRef): string =>
  JSON.stringify([workspaceId, session.agent, session.sessionId]);
type ChatState = {
  connection: ConnectionStatus;
  workspaceId?: string;
  agent: AgentKind;
  sessionId?: string;
  modelOverrides: Record<AgentKind, string>;
  defaults: Pick<ProductSettings, 'defaultAgent'>;
  initialDefaultsEligible: boolean;
  reasoningEfforts: Record<AgentKind, string>;
  actualModel?: string;
  /** 仅保存本页已读取/运行的原生模型元数据，不从默认或显式选择推导。 */
  sessionModels: Record<string, { actualModel?: string; nativeModel?: string }>;
  selectedCapability?: AgentCapability;
  contextUsage?: ContextUsage | null;
  compaction?: CompactionState;
  items: ChatItem[];
  inspectedItemId?: string;
  inspectorRequest: number;
  inspectItem(id?: string): void;
  /** 网页选择代次；原生首次返回sessionId不会重建时间线。 */
  conversationVersion: number;
  running: boolean;
  turnId?: string;
  pendingClientTurnId?: string;
  interruptRequested: boolean;
  loadingHistory: boolean;
  historyError?: string;
  historyNotice?: string;
  banner?: string;
  sessionOperations: Record<string, SessionOperation>;
  manageSession(workspaceId: string, session: SessionRef, input: SessionActionInput): Promise<boolean>;
  selectWorkspace(id?: string): void;
  removeWorkspace(id: string, nextId?: string): void;
  resetWorkspaceConversation(id: string, expectedVersion: number): void;
  newSession(agent?: AgentKind): void;
  setAgent(agent: AgentKind): void;
  openSession(session: SessionRef, options?: { preserveDraft?: boolean }): Promise<void>;
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
  inspectedItemId: undefined,
  running: false,
  turnId: undefined,
  pendingClientTurnId: undefined,
  interruptRequested: false,
  loadingHistory: false,
  historyError: undefined,
  historyNotice: undefined,
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
function historyFailure(agent: AgentKind, error: unknown): Pick<ChatState, 'historyError' | 'historyNotice'> {
  const notReplayable = agent === 'antigravity' && error instanceof ApiError && error.code === 'session_not_replayable';
  if (notReplayable)
    return { historyNotice: 'Antigravity 的原生历史暂不能回放；可以继续此会话，本次收到的内容会显示在这里。' };
  return { historyError: `加载会话失败：${error instanceof Error ? error.message : '请重试'}` };
}
function historyViewVersion(
  current: ChatState,
  session: SessionRef,
  generation: number,
  options?: { preserveDraft?: boolean },
) {
  return options?.preserveDraft && current.agent === session.agent && current.sessionId === session.sessionId
    ? current.conversationVersion
    : generation;
}
function historyParameters(current: ChatState, session: SessionRef) {
  if (current.agent === session.agent && current.sessionId === session.sessionId)
    return { modelOverrides: current.modelOverrides, reasoningEfforts: current.reasoningEfforts };
  return {
    modelOverrides: { ...EMPTY_MODEL_OVERRIDES },
    reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS },
  };
}
/** 重试期间先保留已收到的正文；只有成功读取的历史才有资格替换它。 */
function historyRetryItems(current: ChatState, session: SessionRef, options?: { preserveDraft?: boolean }) {
  return options?.preserveDraft && current.agent === session.agent && current.sessionId === session.sessionId
    ? current.items
    : [];
}
function sameSession(current: ChatState, workspaceId: string, session: SessionRef): boolean {
  return (
    current.workspaceId === workspaceId && current.agent === session.agent && current.sessionId === session.sessionId
  );
}
function isSessionRunning(current: ChatState, workspaceId: string, session: SessionRef): boolean {
  return sameSession(current, workspaceId, session) && (current.running || !!current.pendingClientTurnId);
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
    !!current.historyError ||
    (!text.trim() && !current.selectedCapability) ||
    managementPending(current)
  );
}
/** 本阶段保留当前回合控制权，不能通过导航抹掉仍在运行的身份。 */
export function allowConversationNavigation(): boolean {
  const current = useChat.getState();
  if (!current.running && !current.pendingClientTurnId) return true;
  useChat.setState({ banner: '当前会话正在运行，请先停止或等待本轮结束后再切换。' });
  return false;
}
function sendRestriction(current: ChatState, text: string): string | undefined {
  return selectionRestriction(current.selectedCapability, current.sessionId, text);
}
function nativeStatus(event: AgentEvent): { contextUsage?: ContextUsage | null; compaction?: CompactionState } {
  if (event.type === 'context') return { contextUsage: event.usage };
  if (event.type === 'compaction') return { compaction: event.state };
  return {};
}
function newDefaults(current: ChatState) {
  return {
    agent: current.defaults.defaultAgent,
    modelOverrides: { ...EMPTY_MODEL_OVERRIDES },
    reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS },
  };
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
  conversationVersion: 0,
  agent: 'claude',
  modelOverrides: { ...EMPTY_MODEL_OVERRIDES },
  defaults: { defaultAgent: 'claude' },
  initialDefaultsEligible: true,
  reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS },
  sessionOperations: {},
  sessionModels: {},
  inspectorRequest: 0,
  ...emptyConversation,
  inspectItem(id) {
    if (id && !get().items.some((item) => item.id === id)) return;
    set((state) => ({ inspectedItemId: id, inspectorRequest: state.inspectorRequest + 1 }));
  },
  selectWorkspace(id) {
    if (get().workspaceId === id) return;
    if (!allowConversationNavigation()) return;
    const conversationVersion = changeSelection();
    persistWorkspace(id);
    set({ workspaceId: id, ...emptyConversation, ...newDefaults(get()), conversationVersion });
  },
  removeWorkspace(id, nextId) {
    const prefix = JSON.stringify([id]).slice(0, -1) + ',';
    const sessionOperations = Object.fromEntries(
      Object.entries(get().sessionOperations).filter(([key]) => !key.startsWith(prefix)),
    );
    if (lastWorkspaceId() === id) persistWorkspace();
    // 迟到的删除结果只清理所属状态，不能切走用户已经选择的其他工作区。
    if (get().workspaceId === id) get().selectWorkspace(nextId);
    set({
      sessionOperations,
      sessionModels: Object.fromEntries(Object.entries(get().sessionModels).filter(([key]) => !key.startsWith(prefix))),
    });
  },
  newSession(agent = get().defaults.defaultAgent) {
    if (!allowConversationNavigation()) return;
    const conversationVersion = changeSelection();
    set({ ...emptyConversation, ...newDefaults(get()), agent, initialDefaultsEligible: false, conversationVersion });
  },
  resetWorkspaceConversation(id, expectedVersion) {
    const prefix = JSON.stringify([id]).slice(0, -1) + ',';
    set({
      sessionModels: Object.fromEntries(Object.entries(get().sessionModels).filter(([key]) => !key.startsWith(prefix))),
    });
    // 迟到的改目录结果只清理来源项目，不能抢走用户的新选择。
    if (get().workspaceId === id && get().conversationVersion === expectedVersion) get().newSession(get().agent);
  },
  setAgent(agent) {
    const current = get();
    if (current.sessionId || current.running || current.loadingHistory || current.pendingClientTurnId) return;
    set({ initialDefaultsEligible: false });
    if (current.agent !== agent) {
      const conversationVersion = changeSelection();
      set({ ...emptyConversation, agent, conversationVersion });
    }
  },
  async openSession(session, options) {
    if (!allowConversationNavigation()) return;
    const { workspaceId } = get();
    if (!workspaceId) return;
    const generation = changeSelection();
    const conversationVersion = historyViewVersion(get(), session, generation, options);
    const controller = new AbortController();
    historyRequest = controller;
    set({
      ...emptyConversation,
      ...historyParameters(get(), session),
      items: historyRetryItems(get(), session, options),
      agent: session.agent,
      sessionId: session.sessionId,
      actualModel: get().sessionModels[sessionActionKey(workspaceId, session)]?.actualModel,
      loadingHistory: true,
      conversationVersion,
      initialDefaultsEligible: false,
    });
    try {
      const history = await api.sessionEvents(workspaceId, session.sessionId, session.agent, controller.signal);
      if (!historyIsCurrent(controller, generation, workspaceId, session)) return;
      if (history.session.agent !== session.agent || history.session.sessionId !== session.sessionId)
        throw new Error('会话身份不匹配，未载入历史');
      const items = [...history.events, { type: 'turn_end', isError: false } as const].reduce(reduceChat, []);
      const statuses = history.events.reduce((result, event) => ({ ...result, ...nativeStatus(event) }), {});
      const actualModel = reportedModel(history.actualModel);
      set((current) => ({
        items,
        loadingHistory: false,
        actualModel,
        ...statuses,
        sessionModels: {
          ...current.sessionModels,
          [sessionActionKey(workspaceId, session)]: {
            actualModel,
            nativeModel: reportedModel(history.session.nativeModel),
          },
        },
      }));
    } catch (error) {
      if (historyIsCurrent(controller, generation, workspaceId, session)) {
        set({ loadingHistory: false, ...historyFailure(session.agent, error) });
      }
    } finally {
      if (historyRequest === controller) historyRequest = undefined;
    }
  },
  setDefaults(settings) {
    const current = get();
    const defaults = { defaultAgent: settings.defaultAgent };
    set({ defaults });
    if (
      current.initialDefaultsEligible &&
      !current.sessionId &&
      !current.running &&
      !current.loadingHistory &&
      !current.pendingClientTurnId &&
      !current.items.length
    ) {
      set({ agent: defaults.defaultAgent, initialDefaultsEligible: false });
    }
  },
  touchDraft: () => set({ initialDefaultsEligible: false }),
  setModel: (model) =>
    set((current) => ({
      modelOverrides: { ...current.modelOverrides, [current.agent]: model },
      reasoningEfforts:
        model.trim() === current.modelOverrides[current.agent].trim()
          ? current.reasoningEfforts
          : { ...current.reasoningEfforts, [current.agent]: '' },
      initialDefaultsEligible: false,
    })),
  setReasoningEffort: (reasoningEffort) =>
    set((current) => ({
      reasoningEfforts: { ...current.reasoningEfforts, [current.agent]: reasoningEffort },
      initialDefaultsEligible: false,
    })),
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
    if (isSessionRunning(current, workspaceId, session)) {
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
        const conversationVersion = changeSelection();
        set({
          ...emptyConversation,
          modelOverrides: { ...EMPTY_MODEL_OVERRIDES },
          reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS },
          conversationVersion,
        });
      }
      const operations = { ...get().sessionOperations };
      delete operations[key];
      if (input.action === 'delete') {
        const sessionModels = { ...get().sessionModels };
        delete sessionModels[key];
        set({ sessionModels });
      }
      set({ sessionOperations: operations });
      await refreshSessionLists(session.agent);
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
    const restriction = sendRestriction(current, text);
    if (restriction) {
      set({ banner: restriction });
      return false;
    }
    const clientTurnId = crypto.randomUUID();
    const message = text;
    const sent = socket.send({
      type: 'chat.send',
      workspaceId: current.workspaceId,
      agent: current.agent,
      sessionId: current.sessionId,
      text: message,
      ...(current.selectedCapability ? { selection: { id: current.selectedCapability.id } } : {}),
      model: current.modelOverrides[current.agent].trim() || undefined,
      reasoningEffort: current.reasoningEfforts[current.agent].trim() || undefined,
      clientTurnId,
    });
    if (!sent) {
      set({ banner: '连接已断开，消息未发送。请等待重新连接后再试。' });
      return false;
    }
    set((state) => ({
      items: reduceChat(state.items, {
        type: 'user_message',
        text: current.selectedCapability ? `/${current.selectedCapability.name}${text ? ` ${text}` : ''}` : message,
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
function reportedSession(current: ChatState, event: AgentEvent): Partial<ChatState> {
  if (event.type !== 'session' || !current.workspaceId) return {};
  const actualModel = event.model.trim() || undefined;
  const key = sessionActionKey(current.workspaceId, { agent: current.agent, sessionId: event.sessionId });
  return {
    sessionId: event.sessionId,
    actualModel,
    sessionModels: { ...current.sessionModels, [key]: { ...current.sessionModels[key], actualModel } },
  };
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
    ...reportedSession(current, event),
  });
  if (event.type === 'session' && !current.sessionId) void refreshSessionLists(current.agent);
}
function onTurnFinished(msg: Msg<'turn.finished'>): void {
  void refreshSessionLists(msg.agent);
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
      historyError: '连接已断开，已请求中断本轮。请恢复连接后重新读取原生历史，再继续发送。',
    });
  }
  useChat.setState({ connection: status });
}
type Connect = typeof connectChat;
export function startChatConnection(connect: Connect = connectChat): void {
  socket ??= connect({ onMessage: handleServerMessage, onStatus: handleStatus });
}
export const reconnectChat = () => socket?.reconnect();

function reportedModel(model?: string): string | undefined {
  return model?.trim() || undefined;
}
