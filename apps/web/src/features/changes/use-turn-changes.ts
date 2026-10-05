import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '../../lib/api';
import type { TurnChangesRecord, Workspace } from '@ssh-server/shared';
import { useChat } from '../chat/chat-store';

function useTarget(workspaceId: string) {
  // 订阅App已读取的配置；不增加独立请求，目标变化立即切换查询缓存。
  const workspaces = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: ({ signal }) => api.listWorkspaces(signal),
    enabled: false,
  });
  const workspace = workspaces.data?.find((value) => value.id === workspaceId);
  return targetIdentity(workspace);
}
function targetIdentity(workspace?: Workspace): string {
  return JSON.stringify([
    workspace?.localDir,
    workspace?.sshHost,
    workspace?.remoteDir,
    workspace?.authMode,
    workspace?.sync,
  ]);
}
function availableRecords(input: {
  current: boolean;
  error: boolean;
  sessionId?: string;
  records?: TurnChangesRecord[];
  latest?: TurnChangesRecord;
}) {
  if (!input.current || input.error) return [];
  if (input.sessionId) return input.records ?? [];
  return input.latest ? [input.latest] : [];
}
function matchingLatest(latest: TurnChangesRecord | undefined, agent: string, sessionId?: string) {
  return latest?.agent === agent && latest.sessionId === sessionId ? latest : undefined;
}

export function useTurnChanges(workspaceId: string, active = true) {
  const target = useTarget(workspaceId);
  const selectedWorkspace = useChat((state) => state.workspaceId);
  const agent = useChat((state) => state.agent);
  const sessionId = useChat((state) => state.sessionId);
  const version = useChat((state) => state.conversationVersion);
  const latest = useChat((state) => state.latestChanges);
  const current = workspaceId === selectedWorkspace;
  const query = useQuery({
    queryKey: ['turn-changes', workspaceId, agent, sessionId, version, target],
    queryFn: ({ signal }) => api.turnChanges(workspaceId, { agent, sessionId }, signal),
    enabled: active && current && !!sessionId,
  });
  const records = availableRecords({
    current,
    error: query.isError,
    sessionId,
    records: query.data?.records,
    latest: matchingLatest(latest, agent, sessionId),
  });
  return { records, query, current, agent, sessionId, version, target };
}
