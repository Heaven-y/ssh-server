import type {
  AgentKind,
  SessionSummary,
  SessionHistory,
  SessionRecord,
  SessionActionInput,
  SessionForkInput,
} from '@agentdeck/shared/conversation';
import { request } from '../../lib/http';

export const sessionsApi = {
  listSessions: (workspaceId: string, agent: AgentKind, archived = false, signal?: AbortSignal) =>
    request<SessionSummary[]>(
      `/api/projects/${encodeURIComponent(workspaceId)}/sessions?agent=${agent}${archived ? '&archived=true' : ''}`,
      {
        cache: 'no-store',
        signal,
      },
    ),
  orphanSessions: (agent: AgentKind, signal?: AbortSignal) =>
    request<SessionSummary[]>(`/api/sessions?agent=${agent}`, { signal, cache: 'no-store' }),
  /** 原生管理请求不因面板关闭而取消；结果以运行时响应和重新读取为准。 */
  sessionAction: (workspaceId: string, sessionId: string, agent: AgentKind, input: SessionActionInput) =>
    request<void>(
      `/api/projects/${encodeURIComponent(workspaceId)}/sessions/${agent}/${encodeURIComponent(sessionId)}/actions`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),
  /** 分叉可能已写入原生历史，不随弹窗卸载取消或自动重试。 */
  sessionFork: (workspaceId: string, sessionId: string, agent: AgentKind, input: SessionForkInput) =>
    request<{ session: SessionRecord }>(
      `/api/projects/${encodeURIComponent(workspaceId)}/sessions/${agent}/${encodeURIComponent(sessionId)}/fork`,
      { method: 'POST', body: JSON.stringify(input), cache: 'no-store' },
    ),
  sessionEvents: (workspaceId: string, sessionId: string, agent: AgentKind, signal?: AbortSignal) =>
    request<SessionHistory>(
      `/api/projects/${encodeURIComponent(workspaceId)}/sessions/${agent}/${encodeURIComponent(sessionId)}`,
      { signal, cache: 'no-store' },
    ),
  archivedSessions: (agent: AgentKind, signal?: AbortSignal) =>
    request<SessionSummary[]>(`/api/sessions/archived?agent=${agent}`, { signal, cache: 'no-store' }),
};
export const sessionsKeys = {
  archivedSessions: (agent: AgentKind) => ['sessions', 'archived', agent] as const,
  sessions: (workspaceId: string, agent: AgentKind, archived = false) =>
    archived ? (['sessions', workspaceId, agent, 'archived'] as const) : (['sessions', workspaceId, agent] as const),
  /** 单条原生历史：会话身份包含 CLI 与原生 id，缓存不能跨 Agent 复用。 */
  sessionHistory: (workspaceId: string, agent: AgentKind, sessionId: string) =>
    ['session-history', workspaceId, agent, sessionId] as const,
};
