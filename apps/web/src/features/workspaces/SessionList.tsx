import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { LoaderCircle, MessageSquare, MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';
import type { AgentKind, SessionSummary } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { buttonClass } from '../../ui/styles';
import { sessionActionKey, useChat } from '../chat/chat-store';
import { AGENT_LABELS } from '../chat/AgentControls';
import { SessionActionsDialog } from './SessionActionsDialog';
import { useSessionModel } from '../chat/use-session-model';

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
function SessionMoreButton({
  session,
  pending,
  active,
  manage,
}: {
  session: SessionSummary;
  pending: boolean;
  active: boolean;
  manage(session: SessionSummary): void;
}) {
  return (
    <button
      type="button"
      className={`${buttonClass('ghost')} shrink-0 px-1.5`}
      aria-label={`${AGENT_LABELS[session.agent]} 会话“${session.summary || '无标题会话'}”的更多操作`}
      aria-haspopup="dialog"
      title={active ? '会话运行中，结束后可管理' : '更多会话操作'}
      disabled={pending || active}
      onClick={() => manage(session)}
    >
      <MoreHorizontal aria-hidden className="size-4" />
    </button>
  );
}
function SessionEntry({
  session,
  workspaceId,
  archived,
  manage,
}: {
  session: SessionSummary;
  workspaceId: string;
  archived: boolean;
  manage(session: SessionSummary): void;
}) {
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
  const { model, description } = useSessionModel(workspaceId, session);
  const details = `${title} · 运行来源：${AGENT_LABELS[session.agent]} · ${description} · ${timeFormat.format(session.lastModified)}`;
  return (
    <li className="flex items-center gap-0.5">
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        title={details}
        aria-label={`${details}${archived ? ' · 已归档，恢复后继续' : ''}${pending ? ' · 操作处理中' : ''}${active ? ' · 运行中' : ''}`}
        disabled={pending}
        onClick={() => {
          if (archived) manage(session);
          else void openSession(session);
        }}
        className="group flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border-l-2 border-transparent px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-wait aria-[current]:border-accent aria-[current]:bg-muted aria-[current]:text-foreground"
      >
        {active ? (
          <LoaderCircle aria-hidden className="size-4 shrink-0 motion-safe:animate-spin text-accent" />
        ) : (
          <MessageSquare aria-hidden className="size-4 shrink-0 group-aria-[current]:text-accent" />
        )}
        <span className="min-w-0 flex-1 truncate leading-5 group-aria-[current]:font-medium">{title}</span>
        <span
          className="max-w-[45%] shrink-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
          title={description}
        >
          {model || '模型未报告'}
        </span>
      </button>
      <SessionMoreButton session={session} pending={pending} active={active} manage={manage} />
    </li>
  );
}

type SessionSource = { agent: AgentKind; query: UseQueryResult<SessionSummary[]> };
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
        { agent: 'claude', query: claude },
        { agent: 'codex', query: codex },
      ];
}

function WorkspaceSessions({ workspaceId }: { workspaceId: string }) {
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<{ session: SessionSummary; archived: boolean }>();
  const sources = useSessionSources(workspaceId, archived);
  const newSession = useChat((state) => state.newSession);
  const list = sources.flatMap(({ query }) => query.data ?? []).toSorted((a, b) => b.lastModified - a.lastModified);
  return (
    <section aria-labelledby="session-heading" className="flex min-h-0 flex-1 flex-col border-t border-border/70">
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 px-4 py-2">
        <h2 id="session-heading" className="sr-only">
          会话
        </h2>
        <div className="flex items-center gap-1" aria-label="会话列表范围">
          <button
            type="button"
            className={`rounded-md px-2 py-1.5 text-xs ${!archived ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            aria-pressed={!archived}
            onClick={() => setArchived(false)}
          >
            会话
          </button>
          <button
            type="button"
            className={`rounded-md px-2 py-1.5 text-xs ${archived ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            aria-pressed={archived}
            onClick={() => setArchived(true)}
          >
            已归档
          </button>
        </div>
        <button type="button" className={`${buttonClass('ghost')} px-2`} onClick={() => newSession()}>
          <Plus aria-hidden className="size-4" />
          新会话
        </button>
      </div>
      {sources.map(({ agent, query }) => (
        <SessionSourceNotice key={agent} agent={agent} query={query} />
      ))}
      {sources.every(({ query }) => query.isSuccess) && list.length === 0 && (
        <p className="px-5 py-3 text-sm leading-6 text-muted-foreground">
          {archived ? '暂无归档的 Codex 会话。' : '从一条消息开始。这里会显示当前工作区的原生会话。'}
        </p>
      )}
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pt-1 pb-4">
        {list.map((session) => (
          <SessionEntry
            key={`${session.agent}:${session.sessionId}`}
            session={session}
            workspaceId={workspaceId}
            archived={archived}
            manage={(target) => setSelected({ session: target, archived })}
          />
        ))}
      </ul>
      {selected && (
        <SessionActionsDialog
          key={JSON.stringify([workspaceId, selected.session.agent, selected.session.sessionId, selected.archived])}
          workspaceId={workspaceId}
          session={
            list.find(
              (session) => session.agent === selected.session.agent && session.sessionId === selected.session.sessionId,
            ) ?? selected.session
          }
          archived={selected.archived}
          onClose={() => setSelected(undefined)}
          onCompleted={(action) => {
            setSelected(undefined);
            if (action === 'unarchive') setArchived(false);
          }}
        />
      )}
    </section>
  );
}

/** 两类来源独立读取；工作区切换会关闭详情，但不会取消全局跟踪的原生管理请求。 */
export function SessionList({ workspaceId }: { workspaceId: string }) {
  return <WorkspaceSessions key={workspaceId} workspaceId={workspaceId} />;
}
