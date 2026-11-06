import type { AgentKind, AgentCapabilities } from '@agentdeck/shared/conversation';
import { request } from '../../lib/http';

export const chatApi = {
  agentCapabilities: (workspaceId: string, agent: AgentKind, signal?: AbortSignal, sessionId?: string) =>
    request<AgentCapabilities>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-capabilities?agent=${agent}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ''}`,
      {
        signal,
        cache: 'no-store',
      },
    ),
  refreshAgentCapabilities: (workspaceId: string, agent: AgentKind, sessionId?: string) =>
    request<AgentCapabilities>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/agent-capabilities?agent=${agent}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ''}`,
      {
        method: 'POST',
        cache: 'no-store',
        body: '{}',
      },
    ),
};
export const chatKeys = {
  agentCapabilities: (workspaceId: string, agent: AgentKind, sessionId?: string) =>
    sessionId
      ? (['agent-capabilities', workspaceId, agent, sessionId] as const)
      : (['agent-capabilities', workspaceId, agent] as const),
};
