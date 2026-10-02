// REST 接口封装：Cookie 由 /auth 设置，同源请求自动携带
import type {
  AgentEvent,
  SshAuthMode,
  SshHostInfo,
  SyncSettings,
  SyncStatus,
  Workspace,
  WorkspaceInput,
} from '@ssh-server/shared';

export type SessionSummary = { sessionId: string; summary: string; lastModified: number };

export type SshConnectionTarget = { sshHost: string; remoteDir: string; authMode: SshAuthMode };
export type SshConnectInput = Omit<SshConnectionTarget, 'authMode'> &
  (
    | { authMode: 'key'; password?: never; savePassword?: never }
    | { authMode: 'password'; password?: string; savePassword?: boolean }
  );
export type SshCredentialStatus = { saved: boolean; savingAvailable: boolean; paused: boolean };
export type SshConnectResult = { connected: true; authMode: SshAuthMode } & SshCredentialStatus;

/** 接口错误；field 用于工作区字段校验，code 用于 SSH 错误分类 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
    readonly code?: string,
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
    const body = (await res.json().catch(() => ({}))) as { message?: string; field?: string; code?: string };
    throw new ApiError(res.status, body.message ?? `请求失败（${res.status}）`, body.field, body.code);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const syncUrl = (id: string) => `/api/workspaces/${encodeURIComponent(id)}/sync`;
const postSync = (id: string, suffix = '', body: unknown = {}) =>
  request<SyncStatus>(syncUrl(id) + suffix, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  listWorkspaces: () => request<Workspace[]>('/api/workspaces'),
  createWorkspace: (input: WorkspaceInput) =>
    request<Workspace>('/api/workspaces', {
      method: 'POST',
      // 显式选择可保存的字段，防止运行时附加的凭据进入工作区配置。
      body: JSON.stringify({
        name: input.name,
        localDir: input.localDir,
        sshHost: input.sshHost,
        remoteDir: input.remoteDir,
        authMode: input.authMode,
        policy: input.policy,
        sync: input.sync,
      }),
    }),
  listSshHosts: () => request<SshHostInfo[]>('/api/ssh-hosts'),
  /** 凭据只随这次请求发送，不经过 React Query 或浏览器持久存储。 */
  connectSsh: (input: SshConnectInput, signal?: AbortSignal) =>
    request<SshConnectResult>('/api/ssh/connect', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        sshHost: input.sshHost,
        authMode: input.authMode,
        remoteDir: input.remoteDir,
        password: input.authMode === 'password' ? input.password : undefined,
        savePassword: input.authMode === 'password' ? input.savePassword : undefined,
      }),
    }),
  sshCredentials: (sshHost: string, signal?: AbortSignal) =>
    request<SshCredentialStatus>(`/api/ssh/credentials?sshHost=${encodeURIComponent(sshHost)}`, {
      signal,
      cache: 'no-store',
    }),
  clearSavedSshPassword: (sshHost: string, signal?: AbortSignal) =>
    request<SshCredentialStatus>('/api/ssh/credentials', {
      method: 'PUT',
      signal,
      body: JSON.stringify({ sshHost, savePassword: false }),
    }),
  disconnectSsh: (sshHost: string, signal?: AbortSignal) =>
    request<void>('/api/ssh/disconnect', { method: 'POST', signal, body: JSON.stringify({ sshHost }) }),
  syncStatus: (id: string) => request<SyncStatus>(syncUrl(id)),
  syncWorkspace: (id: string) => postSync(id),
  initializeSync: (id: string) => postSync(id, '/initialize', { confirmed: true }),
  decideSyncDeletions: (id: string, decision: 'confirm' | 'reject') => postSync(id, '/deletions', { decision }),
  acknowledgeSyncConflicts: (id: string) => postSync(id, '/conflicts/ack'),
  updateSyncSettings: (id: string, settings: SyncSettings) => postSync(id, '/settings', settings),
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
  sshCredentials: (sshHost: string) => ['ssh-credentials', sshHost] as const,
  sessions: (workspaceId: string) => ['sessions', workspaceId] as const,
  sync: (workspaceId: string) => ['sync', workspaceId] as const,
};
