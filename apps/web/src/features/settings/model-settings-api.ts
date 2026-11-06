import { request } from '../../lib/http';
import type { AgentCapabilities, AgentKind } from '@agentdeck/shared/conversation';
import type { NativeModelSettingsDocument, NativeModelSettingsInput } from '@agentdeck/shared/settings';

export const modelSettingsApi = {
  catalog: (agent: AgentKind, projectId?: string, signal?: AbortSignal) =>
    request<AgentCapabilities>(
      `/api/settings/models/${agent}/catalog${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
      { signal, cache: 'no-store' },
    ),
  refreshCatalog: (agent: AgentKind, projectId?: string, signal?: AbortSignal) =>
    request<AgentCapabilities>(
      `/api/settings/models/${agent}/catalog${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
      { method: 'POST', signal, cache: 'no-store' },
    ),
  read: (agent: AgentKind, signal?: AbortSignal) =>
    request<NativeModelSettingsDocument>(`/api/settings/models/${agent}`, { signal, cache: 'no-store' }),
  save: (agent: AgentKind, input: NativeModelSettingsInput, signal?: AbortSignal) =>
    request<NativeModelSettingsDocument>(`/api/settings/models/${agent}`, {
      method: 'PUT',
      body: JSON.stringify(input),
      signal,
      cache: 'no-store',
    }),
};
