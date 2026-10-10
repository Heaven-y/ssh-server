import type { UseQueryResult } from '@tanstack/react-query';
import { LoaderCircle, Pin } from 'lucide-react';
import type { AgentKind, SessionSummary } from '@ssh-server/shared';
import { sessionActionKey, useChat } from '../chat/chat-store';
import { AGENT_LABELS } from '../chat/AgentControls';
import { SessionMenu, type SessionMenuAction } from './SessionMenu';
import { useSessionPins } from './session-preferences';

export type SessionSource = { agent: AgentKind; query: UseQueryResult<SessionSummary[]> };
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
function SourceNotice({ agent, query }: SessionSource) {
  if (query.isPending)
    return <p className="px-2 py-2 text-xs text-muted-foreground">正在加载 {AGENT_LABELS[agent]} 会话…</p>;
  if (!query.isError) return null;
  return (
    <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-6 text-destructive-foreground">
      <p role="alert">
        {AGENT_LABELS[agent]} 会话：{query.error.message}
      </p>
      <button
        type="button"
        className="rounded underline underline-offset-4"
        disabled={query.isFetching}
        onClick={() => {
          void query.refetch();
        }}
      >
        重新读取 {AGENT_LABELS[agent]}
      </button>
    </div>
  );
}
type EntryProps = {
  session: SessionSummary;
  workspaceId: string;
  archived: boolean;
  pinned: boolean;
  manage(session: SessionSummary, action: SessionMenuAction): void;
};
function entryLabel(
  details: string,
  {
    archived,
    pending,
    active,
    pinned,
  }: Pick<EntryProps, 'archived' | 'pinned'> & { pending: boolean; active: boolean },
): string {
  return `${details}${archived ? ' · 已归档，恢复后继续' : ''}${pending ? ' · 操作处理中' : ''}${active ? ' · 运行中' : ''}${pinned ? ' · 已置顶' : ''}`;
}
function SessionEntry({ session, workspaceId, archived, pinned, manage }: EntryProps) {
  const current = useChat(
    (state) =>
      !archived &&
      state.workspaceId === workspaceId &&
      state.agent === session.agent &&
      state.sessionId === session.sessionId,
  );
  const running = useChat((state) => state.running);
  const openSession = useChat((state) => state.openSession);
  const pending = useChat((state) => state.sessionOperations[sessionActionKey(workspaceId, session)]?.pending === true);
  const active = current && running;
  const title = session.summary || '无标题会话';
  const details = `${title} · 运行来源：${AGENT_LABELS[session.agent]} · ${timeFormat.format(session.lastModified)}`;
  return (
    <li className="flex items-center gap-0.5">
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        title={details}
        aria-label={entryLabel(details, { archived, pending, active, pinned })}
        disabled={pending || archived}
        onClick={() => {
          if (!archived) void openSession(session);
        }}
        className="group flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border-l-2 border-transparent px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-wait aria-[current]:border-accent aria-[current]:bg-muted aria-[current]:text-foreground"
      >
        {active && <LoaderCircle aria-hidden className="size-3.5 shrink-0 motion-safe:animate-spin text-accent" />}
        {pinned && <Pin aria-hidden className="size-3 shrink-0 text-accent" />}
        <span className="min-w-0 flex-1 truncate leading-5 group-aria-[current]:font-medium">{title}</span>
      </button>
      <SessionMenu
        session={session}
        archived={archived}
        pinned={pinned}
        disabled={pending || active}
        choose={(action) => manage(session, action)}
      />
    </li>
  );
}

export function SessionGroup({
  workspaceId,
  archived,
  agent,
  query,
  manage,
}: SessionSource & Omit<EntryProps, 'session' | 'pinned'>) {
  const pins = useSessionPins((state) => state.pins);
  const pinned = new Set(pins);
  const isPinned = (session: SessionSummary) => !archived && pinned.has(sessionActionKey(workspaceId, session));
  const list = (query.data ?? []).toSorted(
    (a, b) => Number(isPinned(b)) - Number(isPinned(a)) || b.lastModified - a.lastModified,
  );
  return (
    <section aria-label={`${AGENT_LABELS[agent]} 会话`} className="space-y-1">
      <h3 className="flex items-center gap-2 px-2 pt-3 pb-1 text-xs font-semibold text-muted-foreground">
        {AGENT_LABELS[agent]} <span className="font-normal tabular-nums">{list.length}</span>
      </h3>
      <SourceNotice agent={agent} query={query} />
      <ul className="flex flex-col gap-1">
        {list.map((session) => (
          <SessionEntry
            key={session.sessionId}
            session={session}
            workspaceId={workspaceId}
            archived={archived}
            pinned={isPinned(session)}
            manage={manage}
          />
        ))}
      </ul>
    </section>
  );
}
