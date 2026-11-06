import type {
  RemoteBrowseTarget,
  RemoteBrowseSession,
  RemoteDirectory,
  RemoteFileActionInput,
  RemoteFilePreflight,
  RemoteFileTask,
} from '@agentdeck/shared/ssh';
import { request } from '../../../../lib/http';

const remoteSessionsUrl = (id: string) => `/api/workspaces/${encodeURIComponent(id)}/remote-files/sessions`;
export const remoteFilesApi = {
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
};
