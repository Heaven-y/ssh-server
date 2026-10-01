// REST 接口封装：Cookie 由 /auth 设置，同源请求自动携带
import type { AgentEvent, SshHostInfo, Workspace, WorkspaceInput } from '@ssh-server/shared';

export type SessionSummary = { sessionId: string; summary: string; lastModified: number };

/** 接口错误；field 来自后端的字段校验（400 { field, message }） */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (res.status === 401) throw new ApiError(401, '未登录：请打开后端启动时打印的访问地址');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; field?: string };
    throw new ApiError(res.status, body.message ?? `请求失败（${res.status}）`, body.field);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  listWorkspaces: () => request<Workspace[]>('/api/workspaces'),
  createWorkspace: (input: WorkspaceInput) =>
    request<Workspace>('/api/workspaces', { method: 'POST', body: JSON.stringify(input) }),
  listSshHosts: () => request<SshHostInfo[]>('/api/ssh-hosts'),
  listSessions: (workspaceId: string) =>
    request<SessionSummary[]>(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`),
  sessionEvents: (workspaceId: string, sessionId: string) =>
    request<AgentEvent[]>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/events`,
    ),
};

/** react-query 的缓存键，集中定义便于失效刷新 */
export const queryKeys = {
  workspaces: ['workspaces'] as const,
  sshHosts: ['ssh-hosts'] as const,
  sessions: (workspaceId: string) => ['sessions', workspaceId] as const,
};
