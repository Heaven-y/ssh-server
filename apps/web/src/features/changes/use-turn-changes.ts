import { useQuery } from '@tanstack/react-query';
import type { TurnChangesRecord } from '@ssh-server/shared';
import { api } from '../../lib/api';
import { useChat } from '../chat/chat-store';

function mergeRecords(records: TurnChangesRecord[], latest?: TurnChangesRecord): TurnChangesRecord[] {
  const merged = new Map(records.map((record) => [record.turnId, record]));
  if (latest) merged.set(latest.turnId, latest);
  return [...merged.values()].sort((left, right) => right.startedAt - left.startedAt).slice(0, 20);
}

export function useTurnChanges(workspaceId: string, active = true) {
  const selectedWorkspace = useChat((state) => state.workspaceId);
  const agent = useChat((state) => state.agent);
  const sessionId = useChat((state) => state.sessionId);
  const version = useChat((state) => state.conversationVersion);
  const latest = useChat((state) => state.latestChanges);
  const current = workspaceId === selectedWorkspace;
  const query = useQuery({
    queryKey: ['turn-changes', workspaceId, agent, sessionId, version],
    queryFn: ({ signal }) => api.turnChanges(workspaceId, { agent, sessionId }, signal),
    enabled: active && current && !!sessionId,
  });
  const matchingLatest = latest?.agent === agent && latest.sessionId === sessionId ? latest : undefined;
  const records = current ? mergeRecords(query.data?.records ?? [], matchingLatest) : [];
  return { records, query, current, agent, sessionId, version };
}
