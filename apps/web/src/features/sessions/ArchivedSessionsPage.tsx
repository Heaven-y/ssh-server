import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';
import { Archive, ArrowLeft, RefreshCw } from 'lucide-react';
import { nativeSessionCapabilities, type SessionSummary, type Workspace } from '@agentdeck/shared';
import { api, queryKeys } from '../../lib/api';
import { buttonClass, inputClass } from '../../ui/styles';
import { AgentIcon } from '../../ui/BrandIcons';
import { SessionActionsDialog } from './SessionActionsDialog';
import { useSessionBusy } from './use-session-busy';
import type { ProjectDraft } from '../../app/project-management';
import { AGENT_LABELS } from '../chat/AgentControls';

type Selection = { session: SessionSummary; action: 'unarchive' | 'delete' };
type Props = { projects: Workspace[]; close(): void; addProject(draft: ProjectDraft): void };

function ArchivedActions({
  session,
  disabled,
  choose,
}: {
  session: SessionSummary;
  disabled: boolean;
  choose(action: Selection['action']): void;
}) {
  const actions = session.capabilities ?? nativeSessionCapabilities(session.agent);
  return (
    <div className="flex gap-1">
      <button type="button" className={buttonClass('outline')} disabled={disabled} onClick={() => choose('unarchive')}>
        恢复
      </button>
      {actions.delete && (
        <button type="button" className={buttonClass('ghost')} disabled={disabled} onClick={() => choose('delete')}>
          删除
        </button>
      )}
    </div>
  );
}
function latestSelection(rows: SessionSummary[] | undefined, selected?: Selection) {
  if (!selected) return;
  return rows?.find(
    (session) => session.agent === selected.session.agent && session.sessionId === selected.session.sessionId,
  );
}

function ArchivedRow({
  session,
  project,
  choose,
  addProject,
}: {
  session: SessionSummary;
  project?: Workspace;
  choose(action: Selection['action']): void;
  addProject(draft: ProjectDraft): void;
}) {
  const busy = useSessionBusy(session.projectId ?? '', session);
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-4 last:border-0">
      <AgentIcon agent={session.agent} className="size-4 shrink-0" />
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium" title={session.title}>
          {session.title || '未命名会话'}
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground" title={session.directory}>
          {project?.name ?? session.directory ?? '其他目录'} · {AGENT_LABELS[session.agent]} ·{' '}
          {new Date(session.updatedAt).toLocaleString('zh-CN')}
        </p>
      </div>
      {project ? (
        <ArchivedActions session={session} disabled={busy.running || busy.pending} choose={choose} />
      ) : session.directory ? (
        <button type="button" className={buttonClass('outline')} onClick={() => addProject({ dir: session.directory })}>
          加为项目后管理
        </button>
      ) : (
        <span className="text-xs text-muted-foreground">原生目录不可用</span>
      )}
    </li>
  );
}

/** 一处查看原生与工作台归档，写操作仍复用来源项目身份校验。 */
export default function ArchivedSessionsPage({ projects, close, addProject }: Props) {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Selection>();
  const back = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    back.current?.focus();
  }, []);
  const queries = useQueries({
    queries: (['codex', 'claude', 'antigravity'] as const).map((agent) => ({
      queryKey: queryKeys.archivedSessions(agent),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.archivedSessions(agent, signal),
      retry: false,
    })),
  });
  const rows = queries.flatMap((query) => query.data ?? []);
  const pending = queries.some((query) => query.isPending);
  const errors = queries.filter((query) => query.isError).map((query) => query.error.message);
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const phrase = search.trim().toLocaleLowerCase();
  const sessions = rows
    .filter((session) =>
      `${session.title} ${session.directory ?? ''} ${projectsById.get(session.projectId ?? '')?.name ?? ''} ${AGENT_LABELS[session.agent]}`
        .toLocaleLowerCase()
        .includes(phrase),
    )
    .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const selectedSession = latestSelection(rows, selected);
  return (
    <section aria-label="已归档会话页面" className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Archive aria-hidden className="size-4" />
        <h1 className="flex-1 text-sm font-semibold">已归档会话</h1>
        <button ref={back} type="button" className={buttonClass('ghost')} onClick={close}>
          <ArrowLeft aria-hidden className="size-4" />
          返回对话
        </button>
      </header>
      <div className="mx-auto flex w-full max-w-4xl min-h-0 flex-1 flex-col gap-4 p-6">
        <div className="flex items-center gap-2">
          <input
            aria-label="搜索已归档会话"
            placeholder="搜索会话、项目或目录"
            className={`${inputClass} min-w-0 flex-1`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            type="button"
            aria-label="刷新归档会话"
            title="刷新归档会话"
            disabled={queries.some((query) => query.isFetching)}
            className={buttonClass('ghost')}
            onClick={() => queries.forEach((query) => void query.refetch())}
          >
            <RefreshCw aria-hidden className="size-4" />
          </button>
        </div>
        {pending && (
          <p role="status" className="text-sm text-muted-foreground">
            正在读取归档会话…
          </p>
        )}
        {errors.map((error, index) => (
          <p key={index} role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
        ))}
        {!pending && !errors.length && !sessions.length && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {phrase ? '没有匹配的归档会话' : '暂无已归档会话'}
          </p>
        )}
        <ul className="min-h-0 overflow-y-auto rounded-xl border border-border empty:hidden">
          {sessions.map((session) => (
            <ArchivedRow
              key={`${session.agent}:${session.sessionId}`}
              session={session}
              project={projectsById.get(session.projectId ?? '')}
              choose={(action) => setSelected({ session, action })}
              addProject={addProject}
            />
          ))}
        </ul>
      </div>
      {selected && selectedSession?.projectId && (
        <SessionActionsDialog
          key={`${selectedSession.projectId}:${selectedSession.sessionId}:${selected.action}`}
          workspaceId={selectedSession.projectId}
          session={selectedSession}
          archived
          action={selected.action}
          onClose={() => setSelected(undefined)}
          onCompleted={() => {
            setSelected(undefined);
            void client.invalidateQueries({ queryKey: ['sessions'] });
            requestAnimationFrame(() => back.current?.focus());
          }}
        />
      )}
    </section>
  );
}
