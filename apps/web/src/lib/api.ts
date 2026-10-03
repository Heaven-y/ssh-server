// REST 接口封装：Cookie 由 /auth 设置，同源请求自动携带
import type {
  AgentKind,
  AgentCapabilities,
  SessionSummary,
  SessionHistory,
  SessionActionInput,
  NativeConfigAgent,
  NativeConfigDocument,
  NativeConfigInput,
  WorkspaceDirectory,
  WorkspaceFile,
  WorkspaceFileInput,
  RemoteBrowseTarget,
  RemoteBrowseSession,
  RemoteDirectory,
  VersionStatus,
  VersionHistory,
  VersionDiff,
  VersionSaveInput,
  VersionSaveResult,
  VersionRestoreInput,
  VersionRestorePreview,
  VersionRestoreResult,
  SshAuthMode,
  SshHostInfo,
  SyncSettings,
  SyncStatus,
  Workspace,
  WorkspaceInput,
} from '@ssh-server/shared';

export type { SessionSummary } from '@ssh-server/shared';

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
  readonly field?: string;
  readonly code?: string;
  readonly affectedPaths?: string[];

  constructor(
    readonly status: number,
    message: string,
    details: { field?: string; code?: string; affectedPaths?: string[] } = {},
  ) {
    super(message);
    this.field = details.field;
    this.code = details.code;
    this.affectedPaths = details.affectedPaths;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (res.status === 401) throw new ApiError(401, '未登录：请打开后端启动时打印的访问地址');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      field?: string;
      code?: string;
      affectedPaths?: string[];
    };
    throw new ApiError(res.status, body.message ?? `请求失败（${res.status}）`, body);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const syncUrl = (id: string) => `/api/workspaces/${encodeURIComponent(id)}/sync`;
const versionsUrl = (id: string) => `/api/workspaces/${encodeURIComponent(id)}/versions`;
const remoteSessionsUrl = (id: string) => `/api/workspaces/${encodeURIComponent(id)}/remote-files/sessions`;
const fileUrl = (id: string, suffix: string, relative: string) =>
  `/api/workspaces/${encodeURIComponent(id)}/${suffix}?path=${encodeURIComponent(relative)}`;
const postSync = (id: string, suffix = '', body: unknown = {}) =>
  request<SyncStatus>(syncUrl(id) + suffix, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  bindRemoteBrowseTarget: (id: string, target: RemoteBrowseTarget) =>
    request<{ binding: string }>(`/api/workspaces/${encodeURIComponent(id)}/remote-files/bindings`, {
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify(target),
    }),
  createRemoteBrowseSession: (id: string, target: RemoteBrowseTarget, binding: string) =>
    request<RemoteBrowseSession>(remoteSessionsUrl(id), {
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({ ...target, binding }),
    }),
  listRemoteFiles: (id: string, sessionId: string, input: { path: string; cursor?: string }, signal?: AbortSignal) => {
    const query = new URLSearchParams({ path: input.path });
    if (input.cursor) query.set('cursor', input.cursor);
    return request<RemoteDirectory>(`${remoteSessionsUrl(id)}/${encodeURIComponent(sessionId)}?${query}`, {
      signal,
      cache: 'no-store',
    });
  },
  closeRemoteBrowseSession: (id: string, sessionId: string) =>
    request<void>(`${remoteSessionsUrl(id)}/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      keepalive: true,
    }),
  agentCapabilities: (workspaceId: string, agent: AgentKind, signal?: AbortSignal) =>
    request<AgentCapabilities>(`/api/workspaces/${encodeURIComponent(workspaceId)}/agent-capabilities?agent=${agent}`, {
      signal,
      cache: 'no-store',
    }),
  initializeVersions: (id: string) =>
    request<VersionStatus>(versionsUrl(id) + '/initialize', { method: 'POST', body: '{}' }),
  versionStatus: (id: string) => request<VersionStatus>(versionsUrl(id), { cache: 'no-store' }),
  versionHistory: (id: string, skip = 0) =>
    request<VersionHistory>(versionsUrl(id) + `/history?skip=${skip}`, { cache: 'no-store' }),
  versionDiff: (id: string, input: { commit?: string; path?: string } = {}) => {
    const query = new URLSearchParams();
    if (input.commit) query.set('commit', input.commit);
    if (input.path) query.set('path', input.path);
    return request<VersionDiff>(versionsUrl(id) + '/diff?' + query.toString(), { cache: 'no-store' });
  },
  saveVersion: (id: string, input: VersionSaveInput) =>
    request<VersionSaveResult>(versionsUrl(id) + '/save', { method: 'POST', body: JSON.stringify(input) }),
  previewVersionRestore: (id: string, input: VersionRestoreInput) =>
    request<VersionRestorePreview>(versionsUrl(id) + '/restore/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  restoreVersion: (id: string, input: VersionRestoreInput & { revision: string }) =>
    request<VersionRestoreResult>(versionsUrl(id) + '/restore', {
      method: 'POST',
      body: JSON.stringify({ ...input, confirmed: true }),
    }),
  listFiles: (id: string, relative = '', signal?: AbortSignal) =>
    request<WorkspaceDirectory>(fileUrl(id, 'files', relative), { signal, cache: 'no-store' }),
  readFile: (id: string, relative: string, signal?: AbortSignal) =>
    request<WorkspaceFile>(fileUrl(id, 'file', relative), { signal, cache: 'no-store' }),
  fileRevision: (id: string, relative: string, signal?: AbortSignal) =>
    request<{ revision: string }>(fileUrl(id, 'file/revision', relative), { signal, cache: 'no-store' }),
  saveFile: (id: string, input: WorkspaceFileInput) =>
    request<WorkspaceFile>(`/api/workspaces/${encodeURIComponent(id)}/file`, {
      method: 'PUT',
      cache: 'no-store',
      body: JSON.stringify(input),
    }),
  /** 原生配置内容只能由显式打开的编辑区持有，不接入查询缓存或持久存储。 */
  readAgentConfig: (agent: NativeConfigAgent, signal?: AbortSignal) =>
    request<NativeConfigDocument>(`/api/agent-config/${agent}`, { signal, cache: 'no-store' }),
  saveAgentConfig: (agent: NativeConfigAgent, input: NativeConfigInput, signal?: AbortSignal) =>
    request<NativeConfigDocument>(`/api/agent-config/${agent}`, {
      method: 'PUT',
      signal,
      cache: 'no-store',
      body: JSON.stringify({ content: input.content, revision: input.revision }),
    }),
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
  listSessions: (workspaceId: string, agent: AgentKind = 'claude', archived = false) =>
    request<SessionSummary[]>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions?agent=${agent}${archived ? '&archived=true' : ''}`,
      {
        cache: 'no-store',
      },
    ),
  /** 原生管理请求不因面板关闭而取消；结果以运行时响应和重新读取为准。 */
  sessionAction: (workspaceId: string, sessionId: string, agent: AgentKind, input: SessionActionInput) =>
    request<void>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/actions?agent=${agent}`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),
  sessionEvents: (workspaceId: string, sessionId: string, agent: AgentKind = 'claude', signal?: AbortSignal) =>
    request<SessionHistory>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/events?agent=${agent}`,
      { signal, cache: 'no-store' },
    ),
};

/** react-query 的缓存键，集中定义便于失效刷新 */
export const queryKeys = {
  agentCapabilities: (workspaceId: string, agent: AgentKind) => ['agent-capabilities', workspaceId, agent] as const,
  workspaces: ['workspaces'] as const,
  sshHosts: ['ssh-hosts'] as const,
  sshCredentials: (sshHost: string) => ['ssh-credentials', sshHost] as const,
  sessions: (workspaceId: string, agent: AgentKind = 'claude', archived = false) =>
    archived ? (['sessions', workspaceId, agent, 'archived'] as const) : (['sessions', workspaceId, agent] as const),
  sync: (workspaceId: string) => ['sync', workspaceId] as const,
  versions: (workspaceId: string) => ['versions', workspaceId] as const,
};
