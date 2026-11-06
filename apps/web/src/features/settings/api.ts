import type { AgentKind } from '@agentdeck/shared/conversation';
import type {
  NativeConfigAgent,
  NativeConfigDocument,
  NativeConfigInput,
  NativeResourceCatalog,
  NativeResourceDocument,
  NativeResourceSaveInput,
  NativeResourceCreateInput,
  NativeResourceSaved,
  LaunchEnvironmentDocument,
  LaunchEnvironmentInput,
  ProductSettingsDocument,
  ProductSettingsInput,
  EnvironmentReport,
} from '@agentdeck/shared/settings';
import { request } from '../../lib/http';

export type NativeResourceContext = { agent: AgentKind; projectId?: string };
function nativeResourceUrl(context: NativeResourceContext, suffix = '') {
  const query = context.projectId ? `?${new URLSearchParams({ projectId: context.projectId })}` : '';
  return `/api/native-resources/${context.agent}${suffix}${query}`;
}

export const settingsApi = {
  listNativeResources: (context: NativeResourceContext, signal?: AbortSignal) =>
    request<NativeResourceCatalog>(nativeResourceUrl(context), { signal, cache: 'no-store' }),
  /** 正文只在用户显式打开时获取，不能放入查询缓存。 */
  openNativeResource: (context: NativeResourceContext, id: string, signal?: AbortSignal) =>
    request<NativeResourceDocument>(nativeResourceUrl(context, `/${encodeURIComponent(id)}/open`), {
      method: 'POST',
      body: '{}',
      signal,
      cache: 'no-store',
    }),
  saveNativeResource: (
    context: NativeResourceContext,
    id: string,
    input: NativeResourceSaveInput,
    signal?: AbortSignal,
  ) =>
    request<NativeResourceSaved>(nativeResourceUrl(context, `/${encodeURIComponent(id)}`), {
      method: 'PUT',
      body: JSON.stringify(input),
      signal,
      cache: 'no-store',
    }),
  createNativeResource: (context: NativeResourceContext, input: NativeResourceCreateInput, signal?: AbortSignal) =>
    request<NativeResourceSaved>(nativeResourceUrl(context), {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
      cache: 'no-store',
    }),
  readLaunchEnvironment: (agent: AgentKind, signal?: AbortSignal) =>
    request<LaunchEnvironmentDocument>(`/api/settings/launch-environment/${agent}`, { signal, cache: 'no-store' }),
  saveLaunchEnvironment: (agent: AgentKind, input: LaunchEnvironmentInput, signal?: AbortSignal) =>
    request<LaunchEnvironmentDocument>(`/api/settings/launch-environment/${agent}`, {
      method: 'PUT',
      body: JSON.stringify(input),
      signal,
      cache: 'no-store',
    }),
  restartAgentRuntime: (agent: AgentKind, signal?: AbortSignal) =>
    request<void>(`/api/settings/launch-environment/${agent}/restart`, { method: 'POST', body: '{}', signal }),
  readProductSettings: (signal?: AbortSignal) =>
    request<ProductSettingsDocument>('/api/settings/product', { signal, cache: 'no-store' }),
  saveProductSettings: (input: ProductSettingsInput, signal?: AbortSignal) =>
    request<ProductSettingsDocument>('/api/settings/product', { method: 'PUT', body: JSON.stringify(input), signal }),
  readEnvironment: (signal?: AbortSignal) =>
    request<EnvironmentReport>('/api/settings/environment', { signal, cache: 'no-store' }),
  detectEnvironment: (signal?: AbortSignal) =>
    request<EnvironmentReport>('/api/settings/environment', { method: 'POST', body: '{}', signal }),
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
};
export const settingsKeys = {
  productSettings: ['product-settings'] as const,
  environment: ['environment'] as const,
};
