import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TurnChangesRecord, TurnFileChange, VersionChange, VersionStatus, Workspace } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { useChat } from '../chat/chat-store';
import { useTurnChanges } from './use-turn-changes';
import { useDiscard } from './use-discard';
import type { ChangesRequest, FeedbackSource, LineFeedbackInput } from './types';

type Selection = { nonce?: string; turnId?: string; path?: string };
export type ChangesPanelInput = { workspace: Workspace; active: boolean; request?: ChangesRequest; dirty: boolean };
function requestedSelection(selection: Selection, request?: ChangesRequest): Selection {
  return request?.nonce && request.nonce !== selection.nonce ? { turnId: request.turnId } : selection;
}
function currentChanges(
  turnId: string | undefined,
  record: TurnChangesRecord | undefined,
  status?: VersionStatus,
): Array<VersionChange | TurnFileChange> {
  return turnId ? (record?.changes ?? []) : (status?.changes ?? []);
}
function selectedPath(changes: VersionChange[], selected?: string): string | undefined {
  return changes.some((file) => file.path === selected) ? selected : changes[0]?.path;
}
function feedbackSource(input: { turnId?: string; revision?: string; head?: string }): FeedbackSource | undefined {
  if (input.turnId) return { kind: 'turn', id: input.turnId, label: '本轮期间的本地净差异' };
  if (!input.revision) return undefined;
  return {
    kind: 'working',
    id: input.revision,
    label: `相对上次保存版本${input.head ? ` ${input.head.slice(0, 8)}` : '（尚无提交）'}`,
  };
}
function useSelectedDiff(input: {
  workspaceId: string;
  active: boolean;
  busy: boolean;
  path?: string;
  selection: Selection;
  record?: TurnChangesRecord;
  revision?: string;
  turns: ReturnType<typeof useTurnChanges>;
}) {
  const { workspaceId, path, selection, turns } = input;
  return useQuery({
    queryKey: [
      selection.turnId ? 'turn-diff' : 'working-diff',
      workspaceId,
      turns.agent,
      turns.sessionId,
      turns.version,
      turns.target,
      selection.turnId,
      path,
      selection.turnId ? '' : input.revision,
    ],
    queryFn: ({ signal }) =>
      selection.turnId
        ? api.turnDiff(
            workspaceId,
            { agent: turns.agent, sessionId: turns.sessionId, turnId: selection.turnId, path },
            signal,
          )
        : api.versionDiff(workspaceId, { path }, signal),
    enabled: input.active && !input.busy && !!path && (!selection.turnId || !!input.record),
  });
}

function validComparison(input: {
  turnId?: string;
  record?: TurnChangesRecord;
  diffError: boolean;
  statusError: boolean;
  turnsError: boolean;
}) {
  return !input.diffError && (input.turnId ? !input.turnsError && !!input.record : !input.statusError);
}

export function useChangesPanel(input: ChangesPanelInput) {
  const { workspace, active, request } = input;
  const turns = useTurnChanges(workspace.id, active);
  const [manual, setManual] = useState<Selection>({});
  const selection = requestedSelection(manual, request);
  const discard = useDiscard(workspace.id);
  const status = useQuery({
    queryKey: [...queryKeys.versions(workspace.id), turns.target],
    queryFn: ({ signal }) => api.versionStatus(workspace.id, signal),
    enabled: active && !discard.busy,
  });
  const record = turns.records.find((value) => value.turnId === selection.turnId);
  const changes = currentChanges(selection.turnId, record, status.data);
  const path = selectedPath(changes, selection.path);
  const diff = useSelectedDiff({
    workspaceId: workspace.id,
    active,
    busy: discard.busy,
    path,
    selection,
    record,
    revision: status.data?.revision,
    turns,
  });
  const source = feedbackSource({ turnId: selection.turnId, revision: diff.data?.revision, head: status.data?.head });
  const add = useChat((state) => state.addFeedback);
  const error = [status.error, turns.query.error, diff.error].find(Boolean);
  const valid = validComparison({
    turnId: selection.turnId,
    record,
    diffError: diff.isError,
    statusError: status.isError,
    turnsError: turns.query.isError,
  });
  return {
    turns,
    status,
    record,
    changes,
    path,
    selection,
    diff,
    displayDiff: valid ? diff.data : undefined,
    source,
    discard,
    error,
    choose(next: Selection) {
      discard.cancel();
      setManual({ ...next, nonce: request?.nonce });
    },
    refresh() {
      void status.refetch();
      if (turns.current && turns.sessionId) void turns.query.refetch();
      if (path) void diff.refetch();
    },
    feedback:
      turns.current && valid && !!diff.data
        ? (candidate: LineFeedbackInput) =>
            add(candidate, { workspaceId: workspace.id, agent: turns.agent, conversationVersion: turns.version })
        : undefined,
  };
}
export type ChangesPanelModel = ReturnType<typeof useChangesPanel>;
