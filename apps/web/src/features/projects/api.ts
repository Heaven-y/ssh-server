import type { Workspace, WorkspaceInput } from '@agentdeck/shared/projects';
import { request } from '../../lib/http';

export const projectsApi = {
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
};
export const projectsKeys = {
  workspaces: ['workspaces'] as const,
};
