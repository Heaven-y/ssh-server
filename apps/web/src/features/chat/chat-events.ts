import type { AgentEvent, ServerMessage } from '@agentdeck/shared/conversation';
import type { ChatState, ConversationView } from './chat-state';
import type { ChatSocket, ConnectionStatus } from '../../lib/ws';
import { reduceChat } from './chat-reducer';
import { nativeStatus, sameSession, sessionActionKey } from './chat-state-helpers';
import { conversationBusy, conversationById, conversationViews, updateConversation } from './conversations';
import { refreshSessionLists } from '../sessions/session-queries';

type SetState = (patch: Partial<ChatState>) => void;
type Msg<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;
const ended = { running: false, turnId: undefined, pendingClientTurnId: undefined, interruptRequested: false };

export function createChatEvents(
  get: () => ChatState,
  set: SetState,
  send: ChatSocket['send'],
  interrupts: Set<string>,
) {
  function change(view: ConversationView, patch: Partial<ConversationView>) {
    const state = get();
    set(
      updateConversation(state, view, {
        ...patch,
        unread: view.conversationId !== state.conversationId || !state.conversationVisible,
      }),
    );
  }
  function started(msg: Msg<'turn.started'>) {
    if (interrupts.delete(msg.clientTurnId)) send({ type: 'chat.interrupt', turnId: msg.turnId });
    const view = conversationViews(get()).find((entry) => entry.pendingClientTurnId === msg.clientTurnId);
    if (!view || view.workspaceId !== msg.workspaceId || view.agent !== msg.agent) return;
    change(view, { turnId: msg.turnId, pendingClientTurnId: undefined });
  }
  function reported(view: ConversationView, event: AgentEvent) {
    if (event.type !== 'session' || !view.workspaceId) return {};
    const actualModel = event.model.trim() || undefined;
    const state = get();
    const key = sessionActionKey(view.workspaceId, { agent: view.agent, sessionId: event.sessionId });
    set({ sessionModels: { ...state.sessionModels, [key]: { ...state.sessionModels[key], actualModel } } });
    return { sessionId: event.sessionId, actualModel };
  }
  function mergeIdentity(id: string) {
    const state = get();
    const live = conversationById(state, id);
    if (!live?.workspaceId || !live.sessionId) return;
    const session = { agent: live.agent, sessionId: live.sessionId };
    const duplicates = conversationViews(state).filter(
      (entry) => entry.conversationId !== id && sameSession(entry, live.workspaceId!, session),
    );
    if (!duplicates.length) return;
    const selected = duplicates.find((entry) => entry.conversationId === state.conversationId);
    // 原生记录可能先于 session 事件出现在列表；显示同一会话时归并到实时身份并取消旧历史。
    if (selected) state.openConversation(id);
    const draft = [selected, live, ...duplicates].find((entry) => entry?.draft || entry?.selectedCapability);
    const current = conversationById(get(), id)!;
    set(
      updateConversation(get(), current, {
        draft: draft?.draft ?? current.draft,
        selectedCapability: draft?.selectedCapability ?? current.selectedCapability,
      }),
    );
    const obsolete = new Set(duplicates.map((entry) => entry.conversationId));
    set({
      background: Object.fromEntries(Object.entries(get().background).filter(([key]) => !obsolete.has(key))),
      tabIds: [...new Set(get().tabIds.map((entry) => (obsolete.has(entry) ? id : entry)))],
    });
  }
  function event(msg: Msg<'agent.event'>) {
    const view = conversationViews(get()).find((entry) => entry.turnId === msg.turnId);
    if (!view) return;
    const value = msg.event;
    if (value.type === 'session' && value.agent && value.agent !== view.agent) return;
    if (value.type === 'session' && view.sessionId && view.sessionId !== value.sessionId) return;
    const identity = reported(view, value);
    change(view, { items: reduceChat(view.items, value), ...nativeStatus(value), ...identity });
    if (value.type === 'session') {
      mergeIdentity(view.conversationId);
      if (!view.sessionId) void refreshSessionLists(view.agent);
    }
  }
  function finished(msg: Msg<'turn.finished'>) {
    void refreshSessionLists(msg.agent);
    const view = conversationViews(get()).find((entry) => entry.turnId === msg.turnId);
    if (!view || view.workspaceId !== msg.workspaceId || view.agent !== msg.agent) return;
    change(view, { ...ended, items: reduceChat(view.items, { type: 'turn_end', isError: false }) });
  }
  function error(msg: Msg<'error'>) {
    if (msg.clientTurnId) interrupts.delete(msg.clientTurnId);
    const views = conversationViews(get());
    const running = msg.turnId && views.find((entry) => entry.turnId === msg.turnId);
    const view = running || views.find((entry) => !!msg.clientTurnId && entry.pendingClientTurnId === msg.clientTurnId);
    if (view) change(view, { banner: msg.message, ...(!running ? ended : {}) });
  }
  return {
    onMessage(msg: ServerMessage) {
      switch (msg.type) {
        case 'turn.started':
          return started(msg);
        case 'agent.event':
          return event(msg);
        case 'turn.finished':
          return finished(msg);
        case 'error':
          return error(msg);
      }
    },
    onStatus(status: ConnectionStatus) {
      if (status !== 'open') {
        interrupts.clear();
        for (const view of conversationViews(get()).filter(conversationBusy)) {
          change(view, {
            ...ended,
            items: reduceChat(view.items, { type: 'turn_end', isError: true }),
            banner: '连接已断开，本轮输出可能不完整。重新连接后可从会话列表重新打开查看。',
            historyError: '连接已断开，已请求中断本轮。请恢复连接后重新读取原生历史，再继续发送。',
          });
        }
      }
      set({ connection: status });
    },
  };
}
