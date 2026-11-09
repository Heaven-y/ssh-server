import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { shallow } from 'zustand/shallow';
import type { SessionSummary } from '@agentdeck/shared/conversation';
import { useChat } from '../chat/chat-store';
import { conversationBusy, conversationTitle, conversationViews } from '../chat/conversations';
import type { ChatState } from '../chat/chat-state';
import { sessionOrderKey } from './session-order';

export type WorkspaceSession = SessionSummary & { conversationId?: string; local?: boolean };
export const localSessionId = (conversationId: string) => `local:${conversationId}`;

type NavigationEntry = Pick<WorkspaceSession, 'agent' | 'sessionId' | 'title' | 'running'> & {
  conversationId: string;
  workspaceId: string;
  lastSentAt: number;
};
/** 后台正文增量不改变导航投影，避免每个 token 都重排整份摘要。 */
function navigationSelector() {
  let previous = new Map<string, NavigationEntry>();
  return (state: ChatState) => {
    const next = new Map<string, NavigationEntry>();
    for (const view of conversationViews(state)) {
      if (!view.workspaceId || view.lastSentAt === undefined) continue;
      const entry: NavigationEntry = {
        conversationId: view.conversationId,
        workspaceId: view.workspaceId,
        agent: view.agent,
        sessionId: view.sessionId ?? localSessionId(view.conversationId),
        lastSentAt: view.lastSentAt,
        title: conversationTitle(view),
        running: conversationBusy(view),
      };
      const cached = previous.get(view.conversationId);
      next.set(view.conversationId, cached && shallow(cached, entry) ? cached : entry);
    }
    previous = next;
    return [...next.values()];
  };
}

/** 原生 CLI 可能直到退出才写摘要；本页已发送会话先提供可返回的导航。 */
export function useWorkspaceSessions(native: Record<string, SessionSummary[]>) {
  const select = useMemo(() => navigationSelector(), []);
  const current = useChat(useShallow(select));
  return useMemo(() => {
    const result: Record<string, WorkspaceSession[]> = Object.fromEntries(
      Object.entries(native).map(([id, sessions]) => [id, [...sessions]]),
    );
    for (const view of current) {
      const sessions = (result[view.workspaceId] ??= []);
      const identity = { agent: view.agent, sessionId: view.sessionId };
      const index = sessions.findIndex((session) => sessionOrderKey(session) === sessionOrderKey(identity));
      const existing = sessions[index];
      const entry: WorkspaceSession = {
        ...identity,
        projectId: view.workspaceId,
        title: view.title,
        ...existing,
        updatedAt: new Date(Math.max(view.lastSentAt, Date.parse(existing?.updatedAt ?? '') || 0)).toISOString(),
        running: view.running || existing?.running === true,
        conversationId: view.conversationId,
        local: !existing,
      };
      if (existing) sessions[index] = entry;
      else sessions.push(entry);
    }
    return result;
  }, [native, current]);
}
