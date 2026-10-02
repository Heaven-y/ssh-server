import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { LoaderCircle, MessageSquare, Plus } from 'lucide-react';
import type { AgentKind, SessionSummary } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { buttonClass } from '../../ui/styles';
import { useChat } from '../chat/chat-store';
import { AGENT_LABELS } from '../chat/AgentControls';

const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
function SessionSourceNotice({ agent, query }: { agent: AgentKind; query: UseQueryResult<SessionSummary[]> }) {
  if (query.isPending)
    return <p className="px-5 py-2 text-xs text-muted-foreground">正在加载 {AGENT_LABELS[agent]} 会话…</p>;
  if (query.isError)
    return (
      <div className="mx-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-6 text-destructive-foreground">
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
  return null;
}
function SessionEntry({ session }: { session: SessionSummary }) {
  const current = useChat((state) => state.agent === session.agent && state.sessionId === session.sessionId);
  const running = useChat((state) => state.running);
  const openSession = useChat((state) => state.openSession);
  return (
    <li>
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        title={session.summary || '无标题会话'}
        onClick={() => {
          void openSession(session);
        }}
        className="group flex min-h-16 w-full items-start gap-2.5 rounded-lg border-l-2 border-transparent px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground aria-[current]:border-accent aria-[current]:bg-muted aria-[current]:text-foreground"
      >
        {current && running ? (
          <LoaderCircle aria-hidden className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin text-accent" />
        ) : (
          <MessageSquare aria-hidden className="mt-0.5 size-4 shrink-0 group-aria-[current]:text-accent" />
        )}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 leading-5 group-aria-[current]:font-medium">
            {session.summary || '无标题会话'}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{AGENT_LABELS[session.agent]}</span>
            <time dateTime={new Date(session.lastModified).toISOString()}>
              {timeFormat.format(session.lastModified)}
            </time>
            {current && running && <span className="text-accent">运行中</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

/** 两类原生来源独立读取；一个运行时不可用时仍显示另一类会话。 */
export function SessionList({ workspaceId }: { workspaceId: string }) {
  const claude = useQuery({
    queryKey: queryKeys.sessions(workspaceId, 'claude'),
    queryFn: () => api.listSessions(workspaceId, 'claude'),
  });
  const codex = useQuery({
    queryKey: queryKeys.sessions(workspaceId, 'codex'),
    queryFn: () => api.listSessions(workspaceId, 'codex'),
  });
  const newSession = useChat((state) => state.newSession);
  const list = [...(claude.data ?? []), ...(codex.data ?? [])].toSorted((a, b) => b.lastModified - a.lastModified);
  return (
    <section aria-labelledby="session-heading" className="flex min-h-0 flex-1 flex-col border-t border-border/70">
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 px-4 py-2">
        <h2 id="session-heading" className="text-xs font-semibold text-muted-foreground">
          会话
        </h2>
        <button type="button" className={`${buttonClass('ghost')} px-2`} onClick={() => newSession()}>
          <Plus aria-hidden className="size-4" />
          新会话
        </button>
      </div>
      <SessionSourceNotice agent="claude" query={claude} />
      <SessionSourceNotice agent="codex" query={codex} />
      {claude.isSuccess && codex.isSuccess && list.length === 0 && (
        <p className="px-5 py-3 text-sm leading-6 text-muted-foreground">
          从一条消息开始。这里会显示当前工作区的原生会话。
        </p>
      )}
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pt-1 pb-4">
        {list.map((session) => (
          <SessionEntry key={`${session.agent}:${session.sessionId}`} session={session} />
        ))}
      </ul>
    </section>
  );
}
