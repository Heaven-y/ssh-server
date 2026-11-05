import { useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { SessionSummary, Workspace } from '@agentdeck/shared';
import { useChat } from '../features/chat/chat-store';
import { queryKeys } from '../lib/api';

export type ProjectManageAction = 'rename' | 'directory' | 'remove';
export type ProjectDraft = { dir?: string; name?: string };
/** Windows 路径两种分隔符都识别，根目录沿用完整输入。 */
export function projectFolderName(directory: string) {
  return (
    directory
      .trim()
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) || directory.trim()
  );
}
function chatBusy(state: ReturnType<typeof useChat.getState>, projectId?: string) {
  if (state.running || state.pendingClientTurnId) return true;
  const prefix = JSON.stringify([projectId]).slice(0, -1) + ',';
  return Object.entries(state.sessionOperations).some(
    ([key, operation]) => operation.pending && key.startsWith(prefix),
  );
}
export function projectChatBusy(projectId?: string) {
  return chatBusy(useChat.getState(), projectId);
}
export function useProjectChatBusy(projectId?: string) {
  return useChat((state) => chatBusy(state, projectId));
}
function projectSummaryBusy(client: QueryClient, projectId: string) {
  return client
    .getQueriesData<SessionSummary[]>({ queryKey: ['sessions', projectId] })
    .some(([, sessions]) => sessions?.some((session) => session.projectId === projectId && session.running));
}
export function useProjectBusy(projectId: string) {
  const client = useQueryClient();
  const chatBusy = useProjectChatBusy(projectId);
  const summaryBusy = useSyncExternalStore(
    (notify) => client.getQueryCache().subscribe(notify),
    () => projectSummaryBusy(client, projectId),
  );
  return chatBusy || summaryBusy;
}
export function projectIsBusy(client: QueryClient, projectId: string) {
  return projectChatBusy(projectId) || projectSummaryBusy(client, projectId);
}

/** 改目录或移除后取消旧结果，清理该项目对应的会话/能力缓存。 */
export async function clearProjectQueries(client: QueryClient, projectId: string) {
  const predicate = (query: { queryKey: readonly unknown[] }) =>
    ['sessions', 'session-history', 'agent-capabilities'].includes(String(query.queryKey[0])) &&
    query.queryKey[1] === projectId;
  await client.cancelQueries({ predicate });
  client.removeQueries({ predicate });
}
/** 项目映射变化会改变其他目录及重叠项目的归属，取消旧读取后统一刷新摘要。 */
export async function refreshProjectSessionLists(client: QueryClient) {
  await client.cancelQueries({ queryKey: ['sessions'] });
  await client.invalidateQueries({ queryKey: ['sessions'] });
}
export async function updateProjectCache(client: QueryClient, updated: Workspace) {
  await client.cancelQueries({ queryKey: queryKeys.workspaces });
  client.setQueryData<Workspace[]>(queryKeys.workspaces, (projects) =>
    (projects ?? []).map((project) => (project.id === updated.id ? updated : project)),
  );
  void client.invalidateQueries({ queryKey: queryKeys.workspaces });
}
