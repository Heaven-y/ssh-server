import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { SessionSummary } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { buttonClass } from '../../ui/styles';
import { useChat } from '../chat/chat-store';
import { SessionActionsDialog } from './SessionActionsDialog';
import { SessionForkDialog } from './SessionForkDialog';
import { SessionGroup, type SessionSource } from './SessionGroup';
import type { SessionDialogAction, SessionMenuAction } from './SessionMenu';
import { useSessionPins } from './session-preferences';
import { SessionLinkNotice, useSessionLinkCopy } from './use-session-link-copy';

function useSessionSources(workspaceId: string, archived: boolean): SessionSource[] {
  const claude = useQuery({
    queryKey: queryKeys.sessions(workspaceId, 'claude'),
    queryFn: () => api.listSessions(workspaceId, 'claude'),
    enabled: !archived,
  });
  const codex = useQuery({
    queryKey: queryKeys.sessions(workspaceId, 'codex'),
    queryFn: () => api.listSessions(workspaceId, 'codex'),
    enabled: !archived,
  });
  const archive = useQuery({
    queryKey: queryKeys.sessions(workspaceId, 'codex', true),
    queryFn: () => api.listSessions(workspaceId, 'codex', true),
    enabled: archived,
  });
  return archived
    ? [{ agent: 'codex', query: archive }]
    : [
        { agent: 'codex', query: codex },
        { agent: 'claude', query: claude },
      ];
}

type Selection = { session: SessionSummary; archived: boolean; action: SessionDialogAction };
function SessionDialog({
  workspaceId,
  selected,
  list,
  close,
  completed,
}: {
  workspaceId: string;
  selected: Selection;
  list: SessionSummary[];
  close(): void;
  completed(action: SessionDialogAction): void;
}) {
  const session =
    list.find((entry) => entry.agent === selected.session.agent && entry.sessionId === selected.session.sessionId) ??
    selected.session;
  if (selected.action === 'fork')
    return <SessionForkDialog workspaceId={workspaceId} session={session} onClose={close} />;
  return (
    <SessionActionsDialog
      workspaceId={workspaceId}
      session={session}
      archived={selected.archived}
      action={selected.action}
      onClose={close}
      onCompleted={completed}
    />
  );
}
function ListHeader({ archived, change }: { archived: boolean; change(value: boolean): void }) {
  const newSession = useChat((state) => state.newSession);
  return (
    <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 px-4 py-2">
      <h2 id="session-heading" className="sr-only">
        会话
      </h2>
      <div className="flex items-center gap-1" aria-label="会话列表范围">
        <button
          type="button"
          className={`rounded-md px-2 py-1.5 text-xs ${!archived ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          aria-pressed={!archived}
          onClick={() => change(false)}
        >
          会话
        </button>
        <button
          type="button"
          className={`rounded-md px-2 py-1.5 text-xs ${archived ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          aria-pressed={archived}
          onClick={() => change(true)}
        >
          已归档
        </button>
      </div>
      <button type="button" className={`${buttonClass('ghost')} px-2`} onClick={() => newSession()}>
        <Plus aria-hidden className="size-4" />
        新会话
      </button>
    </div>
  );
}
function WorkspaceSessions({ workspaceId }: { workspaceId: string }) {
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<Selection>();
  const sources = useSessionSources(workspaceId, archived);
  const link = useSessionLinkCopy(workspaceId);
  const togglePin = useSessionPins((state) => state.toggle);
  const list = sources.flatMap(({ query }) => query.data ?? []);
  const manage = (session: SessionSummary, action: SessionMenuAction) => {
    link.clear();
    if (action === 'pin') togglePin(workspaceId, session);
    else if (action === 'copy') void link.copy(session);
    else setSelected({ session, archived, action });
  };
  return (
    <section aria-labelledby="session-heading" className="flex min-h-0 flex-1 flex-col border-t border-border/70">
      <ListHeader archived={archived} change={setArchived} />
      <SessionLinkNotice notice={link.notice} link={link.link} />
      {sources.every(({ query }) => query.isSuccess) && list.length === 0 && (
        <p className="px-5 py-3 text-sm leading-6 text-muted-foreground">
          {archived ? '暂无归档会话' : '暂无会话，发送消息开始'}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pt-1 pb-4">
        {sources.map((source) => (
          <SessionGroup key={source.agent} {...source} workspaceId={workspaceId} archived={archived} manage={manage} />
        ))}
      </div>
      {selected && (
        <SessionDialog
          key={JSON.stringify([
            workspaceId,
            selected.session.agent,
            selected.session.sessionId,
            selected.archived,
            selected.action,
          ])}
          workspaceId={workspaceId}
          selected={selected}
          list={list}
          close={() => setSelected(undefined)}
          completed={(action) => {
            setSelected(undefined);
            if (action === 'unarchive') setArchived(false);
          }}
        />
      )}
    </section>
  );
}

/** 两类来源独立读取；工作区切换关闭详情，但不撤销已发出的原生操作。 */
export function SessionList({ workspaceId }: { workspaceId: string }) {
  return <WorkspaceSessions key={workspaceId} workspaceId={workspaceId} />;
}
