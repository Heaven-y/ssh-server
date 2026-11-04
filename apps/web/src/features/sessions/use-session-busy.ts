import type { SessionRef } from '@agentdeck/shared';
import { sessionActionKey, useChat } from '../chat/chat-store';

/** 同一原生身份的摘要、当前回合与管理占用共同决定是否可操作。 */
export function useSessionBusy(workspaceId: string, session: SessionRef & { running?: boolean }) {
  const pending = useChat((state) => state.sessionOperations[sessionActionKey(workspaceId, session)]?.pending === true);
  const currentRunning = useChat(
    (state) =>
      state.workspaceId === workspaceId &&
      state.agent === session.agent &&
      state.sessionId === session.sessionId &&
      (state.running || !!state.pendingClientTurnId),
  );
  return { pending, running: session.running === true || currentRunning };
}
