import { useSessionPages } from './use-session-pages';
import { LoadMoreSessions } from './LoadMoreSessions';
import { useLayoutEffect, useRef, useState } from 'react';
import { Archive, ArrowLeft } from 'lucide-react';
import { legacySessionCapabilities, type SessionSummary } from '@agentdeck/shared/conversation';
import { type Workspace } from '@agentdeck/shared/projects';

import { buttonClass, inputClass } from '../../ui/styles';
import { AgentIcon } from '../../ui/BrandIcons';
import { SessionActionsDialog } from './SessionActionsDialog';
import { useSessionBusy } from './use-session-busy';
import type { ProjectDraft } from '../projects/project-management';
import { AGENT_LABELS } from '../../cli/shared/labels';

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
  const actions = session.capabilities ?? legacySessionCapabilities(session.agent);
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
function isEmpty(page: ReturnType<typeof useSessionPages>) {
  return !page.loading && !page.errors.length && !page.hasMore && !page.sessions.length;
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
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Selection>();
  const back = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    back.current?.focus();
  }, []);
  const page = useSessionPages({ scope: 'archived', search });
  const rows = page.sessions;
  const pending = page.loading;
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const phrase = search.trim();
  const sessions = rows;
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
        </div>
        {pending && (
          <p role="status" className="text-sm text-muted-foreground">
            正在读取归档会话…
          </p>
        )}
        {page.errors.map((query, index) => (
          <p key={index} role="alert" className="text-sm text-destructive-foreground">
            {query.message}
          </p>
        ))}
        {page.errors.length > 0 && (
          <button
            type="button"
            disabled={page.loading}
            className={`${buttonClass('ghost')} self-start`}
            onClick={page.retry}
          >
            重试
          </button>
        )}
        {isEmpty(page) && (
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
        <LoadMoreSessions hasMore={page.hasMore} loading={page.loadingMore} more={page.more} />
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
            requestAnimationFrame(() => back.current?.focus());
          }}
        />
      )}
    </section>
  );
}
