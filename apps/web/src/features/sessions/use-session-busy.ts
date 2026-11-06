import type { SessionRef } from '@agentdeck/shared/conversation';
import { sessionActionKey, useChat } from '../chat/chat-store';
import { sessionIsRunning } from '../chat/conversations';

/** 同一原生身份的摘要、当前回合与管理占用共同决定是否可操作。 */
export function useSessionBusy(workspaceId: string, session: SessionRef & { running?: boolean }) {
  const pending = useChat((state) => state.sessionOperations[sessionActionKey(workspaceId, session)]?.pending === true);
  const currentRunning = useChat((state) => sessionIsRunning(state, workspaceId, session));
  return { pending, running: session.running === true || currentRunning };
}
