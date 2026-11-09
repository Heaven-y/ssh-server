import type { PermissionSelection, SessionPermissionDocument } from '@agentdeck/shared/conversation';
import { sessionsApi } from '../sessions/api';
import type { ChatState, ConversationView } from './chat-state';
import { sameSession } from './chat-state-helpers';
import { conversationById, updateConversation } from './conversations';

export function permissionReadState(result: PromiseSettledResult<SessionPermissionDocument>) {
  return {
    permissionLoading: false,
    permission: result.status === 'fulfilled' ? (result.value.permission ?? undefined) : undefined,
    permissionError: result.status === 'rejected' ? '会话权限读取失败，请重新读取后再发送。' : undefined,
  };
}

/** 保存请求跟随原会话；切换项目或新建会话不会让迟到结果串入当前视图。 */
export function saveConversationPermission(
  get: () => ChatState,
  set: (patch: Partial<ChatState>) => void,
  current: ChatState,
  permission?: PermissionSelection,
) {
  const { workspaceId, sessionId, agent, conversationId } = current;
  set({ permission, permissionError: undefined, initialDefaultsEligible: false });
  if (!workspaceId || !sessionId) return;
  set({ permissionSaving: true });
  function complete(patch: Partial<ConversationView>) {
    const state = get();
    const view = conversationById(state, conversationId);
    if (view && sameSession(view, workspaceId!, { agent, sessionId: sessionId! }))
      set(updateConversation(state, view, { permissionSaving: false, ...patch }));
  }
  void sessionsApi.saveSessionPermission(workspaceId, sessionId, agent, permission ?? null).then(
    () => complete({ permissionError: undefined }),
    () => complete({ permission: current.permission, permissionError: '会话权限保存失败，请重新选择或重新读取权限。' }),
  );
}
