import type { SessionRef } from '@agentdeck/shared/conversation';
import type { ChatState } from './chat-state';
import { sessionsApi } from '../sessions/api';
import { reduceChat } from './chat-reducer';
import { retainConversation } from './conversations';
import {
  emptyConversation,
  historyFailure,
  historyViewVersion,
  historyParameters,
  historyRetryItems,
  sameSession,
  nativeStatus,
  reportedModel,
  sessionActionKey,
} from './chat-state-helpers';

type Options = { preserveDraft?: boolean };
type SetState = (patch: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void;

/** 历史只加载当前视图；离开取消请求，实时回合则由 chat-events 独立路由。 */
export function createChatHistory(get: () => ChatState, set: SetState) {
  let historyRequest: AbortController | undefined;
  let selectionGeneration = 0;
  function changeSelection(): number {
    historyRequest?.abort();
    historyRequest = undefined;
    return ++selectionGeneration;
  }
  function historyIsCurrent(controller: AbortController, generation: number, workspaceId: string, session: SessionRef) {
    const current = get();
    return (
      !controller.signal.aborted &&
      generation === selectionGeneration &&
      current.workspaceId === workspaceId &&
      current.agent === session.agent &&
      current.sessionId === session.sessionId
    );
  }
  function begin(workspaceId: string, session: SessionRef, options?: Options) {
    const current = get();
    const same = sameSession(current, workspaceId, session);
    const generation = changeSelection();
    const conversationVersion = historyViewVersion(current, session, generation, options);
    const controller = new AbortController();
    historyRequest = controller;
    set({
      ...emptyConversation,
      ...historyParameters(current, session),
      items: historyRetryItems(current, session, options),
      draft: same ? current.draft : '',
      view: same ? current.view : 'chat',
      selectedCapability: same ? current.selectedCapability : undefined,
      conversationId: same ? current.conversationId : crypto.randomUUID(),
      background: same ? current.background : retainConversation(current),
      agent: session.agent,
      sessionId: session.sessionId,
      actualModel: get().sessionModels[sessionActionKey(workspaceId, session)]?.actualModel,
      loadingHistory: true,
      conversationVersion,
      initialDefaultsEligible: false,
    });
    return { controller, generation };
  }
  async function read(workspaceId: string, session: SessionRef, options?: Options) {
    const { controller, generation } = begin(workspaceId, session, options);
    try {
      const history = await sessionsApi.sessionEvents(workspaceId, session.sessionId, session.agent, controller.signal);
      if (!historyIsCurrent(controller, generation, workspaceId, session)) return;
      if (history.session.agent !== session.agent || history.session.sessionId !== session.sessionId)
        throw new Error('会话身份不匹配，未载入历史');
      const items = [...history.events, { type: 'turn_end', isError: false } as const].reduce(reduceChat, []);
      const statuses = history.events.reduce((result, event) => ({ ...result, ...nativeStatus(event) }), {});
      const actualModel = reportedModel(history.actualModel);
      set((current) => ({
        items,
        title: history.session.summary,
        loadingHistory: false,
        historyReloadNeeded: false,
        historyReplayable: true,
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
  }
  return { changeSelection, read };
}
