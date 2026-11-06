import type { SessionRef } from '@agentdeck/shared/conversation';
import type { ChatState, ConversationView } from './chat-state';

const fields = [
  'conversationId',
  'workspaceId',
  'agent',
  'sessionId',
  'title',
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
  'historyReloadNeeded',
  'historyReplayable',
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
  const next = { ...state.background };
  delete next[state.conversationId];
  next[state.conversationId] = snapshot;
  return trimConversationBodies(next);
}

function canReload(view: ConversationView) {
  if (!view.sessionId || !view.items.length || conversationBusy(view)) return false;
  if (
    [
      view.unread,
      view.loadingHistory,
      view.draft,
      view.selectedCapability,
      view.historyError,
      view.historyNotice,
      waitingPermission(view),
    ].some(Boolean)
  )
    return false;
  return view.agent !== 'antigravity' || view.historyReplayable;
}
export const needsHistory = (view: ConversationView) =>
  view.loadingHistory || !!view.historyError || view.historyReloadNeeded;
/** 参数和身份保留，只有原生可重读的空闲已读正文受预算约束。 */
function trimConversationBodies(background: ChatState['background']) {
  const candidates = Object.values(background).filter(canReload);
  const sizes = candidates.map((view) => JSON.stringify(view.items).length * 2);
  let bytes = sizes.reduce((sum, size) => sum + size, 0);
  let count = candidates.length;
  for (const [index, view] of candidates.entries()) {
    if (count <= 8 && bytes <= 4 * 1024 * 1024) break;
    background[view.conversationId] = {
      ...view,
      items: [],
      contextUsage: undefined,
      compaction: undefined,
      inspectedItemId: undefined,
      historyReloadNeeded: true,
    };
    count--;
    bytes -= sizes[index]!;
  }
  return background;
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
  if (view.title) return view.title;
  const first = view.items.find((item) => item.kind === 'user');
  return first?.kind === 'user' ? first.text.slice(0, 60) : view.draft.slice(0, 60) || '新会话';
}
export const waitingPermission = (view: ConversationView) =>
  view.items.some((item) => item.kind === 'permission' && !item.resolved);
