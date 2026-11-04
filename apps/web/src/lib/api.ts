// REST 接口封装：启动同源本机会话后，Cookie 由浏览器自动携带。
import type {
  AgentKind,
  AgentCapabilities,
  SessionSummary,
  SessionHistory,
  SessionRecord,
  SessionActionInput,
  SessionForkInput,
  NativeConfigAgent,
  NativeConfigDocument,
  NativeConfigInput,
  RemoteBrowseTarget,
  RemoteBrowseSession,
  RemoteDirectory,
  RemoteFileActionInput,
  RemoteFilePreflight,
  RemoteFileTask,
  SshAuthMode,
  SshHostInfo,
  Workspace,
  WorkspaceInput,
  TerminalTarget,
  TerminalBinding,
  HostTrustStatus,
  HostTrustConfirmation,
  ManualServerInput,
  ManagedServer,
  ResourceSnapshot,
  SlurmSnapshot,
  ProductSettingsDocument,
  ProductSettingsInput,
  EnvironmentReport,
} from '@agentdeck/shared';

export type { SessionSummary } from '@agentdeck/shared';

export type SshConnectionTarget = { sshHost: string; authMode: SshAuthMode };
export type SshConnectInput = { sshHost: string; password?: string; savePassword?: boolean };
export type SshCredentialStatus = {
  saved: boolean;
  savingAvailable: boolean;
  paused: boolean;
  connected: boolean;
  hasPassword: boolean;
};
export type SshConnectResult = { connected: true; authMode: SshAuthMode } & SshCredentialStatus;
export type SshPasswordRead = { password: string | null; revision: string; savingAvailable: boolean };
export type SshServerEditInput = {
  input: ManualServerInput;
  expected: ManagedServer;
  revision: string;
  password?: string | null;
};

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
  if (res.status === 401) throw new ApiError(401, '本机会话已失效，请刷新页面重新连接本机服务');
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

const remoteSessionsUrl = (id: string) => `/api/workspaces/${encodeURIComponent(id)}/remote-files/sessions`;

export const api = {
  readProductSettings: (signal?: AbortSignal) =>
    request<ProductSettingsDocument>('/api/settings/product', { signal, cache: 'no-store' }),
  saveProductSettings: (input: ProductSettingsInput, signal?: AbortSignal) =>
    request<ProductSettingsDocument>('/api/settings/product', { method: 'PUT', body: JSON.stringify(input), signal }),
  readEnvironment: (signal?: AbortSignal) =>
    request<EnvironmentReport>('/api/settings/environment', { signal, cache: 'no-store' }),
  detectEnvironment: (signal?: AbortSignal) =>
    request<EnvironmentReport>('/api/settings/environment', { method: 'POST', body: '{}', signal }),
  readResources: (target: TerminalTarget, signal?: AbortSignal) =>
    request<ResourceSnapshot>(
      `/api/workspaces/${encodeURIComponent(target.workspaceId)}/resources?target=${encodeURIComponent(JSON.stringify(target))}`,
      { signal, cache: 'no-store' },
    ),
  readSlurm: (target: TerminalTarget, signal?: AbortSignal) =>
    request<SlurmSnapshot>(
      `/api/workspaces/${encodeURIComponent(target.workspaceId)}/slurm?target=${encodeURIComponent(JSON.stringify(target))}`,
      { signal, cache: 'no-store' },
    ),
  bindTerminalTarget: (target: TerminalTarget, options: { signal?: AbortSignal; previousBinding?: string } = {}) =>
    request<TerminalBinding>(`/api/workspaces/${encodeURIComponent(target.workspaceId)}/terminal-binding`, {
      method: 'POST',
      cache: 'no-store',
      signal: options.signal,
      body: JSON.stringify({ target, previousBinding: options.previousBinding }),
    }),
  preflightRemoteFile: (id: string, sessionId: string, input: RemoteFileActionInput, signal?: AbortSignal) =>
    request<RemoteFilePreflight>(`${remoteSessionsUrl(id)}/${encodeURIComponent(sessionId)}/preflights`, {
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify(input),
      signal,
    }),
  submitRemoteFileTask: (id: string, preflightId: string) =>
    request<RemoteFileTask>(`/api/workspaces/${encodeURIComponent(id)}/remote-files/tasks`, {
      method: 'POST',
      body: JSON.stringify({ preflightId, confirmed: true }),
    }),
  remoteFileTasks: (id: string, signal?: AbortSignal) =>
    request<{ tasks: RemoteFileTask[] }>(`/api/workspaces/${encodeURIComponent(id)}/remote-files/tasks`, {
      signal,
      cache: 'no-store',
    }),
  remoteFileTaskAction: (id: string, taskId: string, action: 'cancel' | 'check') =>
    request<RemoteFileTask>(
      `/api/workspaces/${encodeURIComponent(id)}/remote-files/tasks/${encodeURIComponent(taskId)}/${action}`,
      { method: 'POST', body: '{}' },
    ),
  bindRemoteBrowseTarget: (id: string, target: RemoteBrowseTarget) =>
    request<{ binding: string }>(`/api/workspaces/${encodeURIComponent(id)}/remote-files/bindings`, {
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify(target),
    }),
  createRemoteBrowseSession: (id: string, target: RemoteBrowseTarget, binding: string, signal?: AbortSignal) =>
    request<RemoteBrowseSession>(remoteSessionsUrl(id), {
      method: 'POST',
      cache: 'no-store',
      signal,
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
  /** 项目列表：接口名沿用旧称，路径已切到 /api/projects（/api/workspaces 是待删的兼容别名）。 */
  listWorkspaces: (signal?: AbortSignal) => request<Workspace[]>('/api/projects', { signal }),
  createProject: (input: WorkspaceInput, signal?: AbortSignal) =>
    request<Workspace>('/api/projects', { method: 'POST', body: JSON.stringify(input), signal }),
  /**
   * 改项目。传 `null` 表示清除该字段（解绑的「退回纯本地项目」要靠它），
   * 没传的键表示不要动——JSON 里没有 undefined，两者不能混为一谈。
   */
  updateProject: (
    id: string,
    input: Partial<Record<'name' | 'dir', string>> & {
      server?: string | null;
      remoteDir?: string | null;
    },
    signal?: AbortSignal,
  ) =>
    request<Workspace>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      signal,
    }),
  deleteProject: (id: string, signal?: AbortSignal) =>
    request<void>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
  listSshHosts: (signal?: AbortSignal) => request<ManagedServer[]>('/api/ssh-targets', { signal, cache: 'no-store' }),
  sshImportOptions: (signal?: AbortSignal) =>
    request<Array<SshHostInfo & { keyFile?: string }>>('/api/ssh-targets/import-options', { signal }),
  saveSshTarget: (input: ManualServerInput, signal?: AbortSignal) =>
    request<ManagedServer>('/api/ssh-targets', { method: 'POST', signal, body: JSON.stringify(input) }),
  updateSshTarget: (alias: string, input: ManualServerInput, expected: ManagedServer, signal?: AbortSignal) =>
    request<ManagedServer>(`/api/ssh-targets/${encodeURIComponent(alias)}`, {
      method: 'PUT',
      signal,
      body: JSON.stringify({ input, expected }),
    }),
  deleteSshTarget: (expected: ManagedServer, signal?: AbortSignal) =>
    request<void>(`/api/ssh-targets/${encodeURIComponent(expected.alias)}`, {
      method: 'DELETE',
      signal,
      body: JSON.stringify({ expected, confirmed: true }),
    }),
  /** 仅编辑器按需使用；响应正文不能交给查询缓存或浏览器持久存储。 */
  readSshPassword: (expected: ManagedServer, signal?: AbortSignal) =>
    request<SshPasswordRead>(`/api/ssh-targets/${encodeURIComponent(expected.alias)}/password/read`, {
      method: 'POST',
      signal,
      cache: 'no-store',
      body: JSON.stringify({ expected }),
    }),
  saveSshTargetEdit: (edit: SshServerEditInput, signal?: AbortSignal) =>
    request<ManagedServer>(`/api/ssh-targets/${encodeURIComponent(edit.expected.alias)}/password`, {
      method: 'PUT',
      signal,
      cache: 'no-store',
      body: JSON.stringify({
        input: edit.input,
        expected: edit.expected,
        revision: edit.revision,
        password: edit.password,
        confirmed: true,
      }),
    }),
  createSshTargetWithPassword: (input: ManualServerInput, password: string, signal?: AbortSignal) =>
    request<ManagedServer>('/api/ssh-targets/with-password', {
      method: 'POST',
      signal,
      cache: 'no-store',
      body: JSON.stringify({ input, password, confirmed: true }),
    }),
  probeHostKey: (sshHost: string, signal?: AbortSignal) =>
    request<HostTrustStatus>('/api/ssh/host-key', {
      method: 'POST',
      signal,
      cache: 'no-store',
      body: JSON.stringify({ sshHost }),
    }),
  confirmHostKey: (input: HostTrustConfirmation, signal?: AbortSignal) =>
    request<HostTrustStatus>('/api/ssh/host-key/confirm', {
      method: 'POST',
      signal,
      cache: 'no-store',
      body: JSON.stringify(input),
    }),
  /** 凭据只随这次请求发送，不经过 React Query 或浏览器持久存储。 */
  connectSsh: (input: SshConnectInput, signal?: AbortSignal) =>
    request<SshConnectResult>('/api/ssh/connect', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        sshHost: input.sshHost,
        password: input.password,
        savePassword: input.savePassword,
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
  listSessions: (workspaceId: string, agent: AgentKind, archived = false, signal?: AbortSignal) =>
    request<SessionSummary[]>(
      `/api/projects/${encodeURIComponent(workspaceId)}/sessions?agent=${agent}${archived ? '&archived=true' : ''}`,
      {
        cache: 'no-store',
        signal,
      },
    ),
  /** 原生管理请求不因面板关闭而取消；结果以运行时响应和重新读取为准。 */
  // 动作与分叉目前仍只有 /api/workspaces/:id/... 前缀（Task 9 只迁了两个 GET），
  // 前端先保持可用；等后端补 /api/projects 前缀后一并切换并删除旧别名。
  sessionAction: (workspaceId: string, sessionId: string, agent: AgentKind, input: SessionActionInput) =>
    request<void>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/actions?agent=${agent}`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),
  /** 分叉可能已写入原生历史，不随弹窗卸载取消或自动重试。 */
  sessionFork: (workspaceId: string, sessionId: string, agent: AgentKind, input: SessionForkInput) =>
    request<{ session: SessionRecord }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/fork?agent=${agent}`,
      { method: 'POST', body: JSON.stringify(input), cache: 'no-store' },
    ),
  sessionEvents: (workspaceId: string, sessionId: string, agent: AgentKind, signal?: AbortSignal) =>
    request<SessionHistory>(
      `/api/projects/${encodeURIComponent(workspaceId)}/sessions/${agent}/${encodeURIComponent(sessionId)}`,
      { signal, cache: 'no-store' },
    ),
};

/** react-query 的缓存键，集中定义便于失效刷新 */
export const queryKeys = {
  productSettings: ['product-settings'] as const,
  environment: ['environment'] as const,
  sshImportOptions: ['ssh-import-options'] as const,
  agentCapabilities: (workspaceId: string, agent: AgentKind) => ['agent-capabilities', workspaceId, agent] as const,
  workspaces: ['workspaces'] as const,
  sshHosts: ['ssh-targets'] as const,
  sshCredentials: (sshHost: string) => ['ssh-credentials', sshHost] as const,
  sessions: (workspaceId: string, agent: AgentKind, archived = false) =>
    archived ? (['sessions', workspaceId, agent, 'archived'] as const) : (['sessions', workspaceId, agent] as const),
  /** 单条原生历史：会话身份包含 CLI 与原生 id，缓存不能跨 Agent 复用。 */
  sessionHistory: (workspaceId: string, agent: AgentKind, sessionId: string) =>
    ['session-history', workspaceId, agent, sessionId] as const,
};
