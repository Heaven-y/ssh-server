import type { ChatState } from './chat-state';
import { conversationById, retainConversation } from './conversations';
import { emptyConversation, EMPTY_MODEL_OVERRIDES, DEFAULT_REASONING_EFFORTS } from './chat-state-helpers';

export const openedTab = (ids: string[], id: string) => (ids.includes(id) ? ids : [...ids, id]);
export const existingTabs = (state: ChatState) => state.tabIds.filter((id) => conversationById(state, id));

/** 关闭仅移除导航入口；后台任务、审批和草稿仍留在原会话中。 */
export function createConversationTabs(
  get: () => ChatState,
  set: (patch: Partial<ChatState>) => void,
  changeSelection: () => number,
) {
  return {
    closeConversationTab(id: string) {
      const current = get();
      const index = current.tabIds.indexOf(id);
      if (index < 0) return;
      const tabIds = current.tabIds.filter((entry) => entry !== id);
      if (current.conversationId === id) {
        const next = tabIds[index] ?? tabIds.at(-1);
        if (next) current.openConversation(next);
        else {
          const background = retainConversation(current);
          set({
            ...emptyConversation,
            agent: current.defaults.defaultAgent,
            modelOverrides: { ...EMPTY_MODEL_OVERRIDES },
            reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS },
            permission: undefined,
            conversationId: crypto.randomUUID(),
            conversationVersion: changeSelection(),
            background,
          });
        }
      }
      set({ tabIds });
    },
    moveConversationTab(id: string, target: string) {
      const ids = get().tabIds;
      if (id === target || !ids.includes(id) || !ids.includes(target)) return;
      const tabIds = ids.filter((entry) => entry !== id);
      tabIds.splice(ids.indexOf(target), 0, id);
      set({ tabIds });
    },
  };
}
