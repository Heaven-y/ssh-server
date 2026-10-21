import type { TurnChangesRecord } from '@ssh-server/shared';
import { useChat } from '../chat/chat-store';

/**
 * 本轮改动只来自原生事件与状态对比，随 turn.finished 推送到网页；
 * 不再请求服务端历史，避免为查看改动而读取工作区。
 */
export function useTurnChanges(workspaceId: string, active = true) {
  const selectedWorkspace = useChat((state) => state.workspaceId);
  const agent = useChat((state) => state.agent);
  const sessionId = useChat((state) => state.sessionId);
  const version = useChat((state) => state.conversationVersion);
  const latest = useChat((state) => state.latestChanges);
  const current = workspaceId === selectedWorkspace;
  const matches = !!latest && latest.agent === agent && latest.sessionId === sessionId;
  const records: TurnChangesRecord[] = active && current && matches ? [latest] : [];
  return { records, current, agent, sessionId, version, target: JSON.stringify([workspaceId, agent, sessionId, version]) };
}
