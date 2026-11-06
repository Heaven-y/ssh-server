import type { SessionRef } from '@agentdeck/shared/conversation';
import type { ChatState, ConversationView } from './chat-state';

const fields = [
  'conversationId',
  'workspaceId',
  'agent',
  'sessionId',
  'modelOverrides',
  'reasoningEfforts',
  'permission',
  'actualModel',
  'selectedCapability',
  'contextUsage',
  'compaction',
  'items',
  'inspectedItemId',
  'conversationVersion',
  'running',
  'turnId',
  'pendingClientTurnId',
  'interruptRequested',
  'loadingHistory',
  'historyError',
  'historyNotice',
  'banner',
  'draft',
  'unread',
  'view',
] as const satisfies readonly (keyof ConversationView)[];

export const conversationBusy = (view: ConversationView) => view.running || !!view.pendingClientTurnId;
export const conversationHasDraft = (view: ConversationView) =>
  !!(
    view.draft ||
    view.selectedCapability ||
    view.permission ||
    Object.values(view.modelOverrides).some(Boolean) ||
    Object.values(view.reasoningEfforts).some(Boolean)
  );
export const conversationViews = (state: ChatState): ConversationView[] => [state, ...Object.values(state.background)];
export const conversationById = (state: ChatState, id: string): ConversationView | undefined =>
  state.conversationId === id ? state : state.background[id];
export function conversationForSession(state: ChatState, workspaceId: string, session: SessionRef) {
  return conversationViews(state).find(
    (view) => view.workspaceId === workspaceId && view.agent === session.agent && view.sessionId === session.sessionId,
  );
}
export function sessionIsRunning(state: ChatState, workspaceId: string, session: SessionRef) {
  return conversationViews(state).some(
    (view) =>
      view.workspaceId === workspaceId &&
      view.agent === session.agent &&
      view.sessionId === session.sessionId &&
      conversationBusy(view),
  );
}
export function projectIsRunning(state: ChatState, workspaceId?: string) {
  return conversationViews(state).some((view) => view.workspaceId === workspaceId && conversationBusy(view));
}
export function retainConversation(state: ChatState): ChatState['background'] {
  if (
    !state.workspaceId ||
    (!state.sessionId && !state.items.length && !conversationHasDraft(state) && !conversationBusy(state))
  )
    return state.background;
  const snapshot = Object.fromEntries(fields.map((field) => [field, state[field]])) as ConversationView;
  return { ...state.background, [state.conversationId]: snapshot };
}
export function updateConversation(
  state: ChatState,
  view: ConversationView,
  patch: Partial<ConversationView>,
): Partial<ChatState> {
  return view.conversationId === state.conversationId
    ? patch
    : { background: { ...state.background, [view.conversationId]: { ...view, ...patch } } };
}
export function conversationTitle(view: ConversationView): string {
  const first = view.items.find((item) => item.kind === 'user');
  return first?.kind === 'user' ? first.text.slice(0, 60) : view.draft.slice(0, 60) || '新会话';
}
export const waitingPermission = (view: ConversationView) =>
  view.items.some((item) => item.kind === 'permission' && !item.resolved);
