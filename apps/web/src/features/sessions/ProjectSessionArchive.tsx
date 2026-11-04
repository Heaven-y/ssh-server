import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Archive, ChevronRight } from 'lucide-react';
import type { SessionSummary } from '@agentdeck/shared';
import { api, queryKeys } from '../../lib/api';
import { ProjectSessionRow } from './ProjectSessionRow';
import type { SessionDialogAction } from './SessionMenu';

type Props = {
  workspaceId: string;
  projectName: string;
  manage(session: SessionSummary, action: SessionDialogAction, archived: boolean): void;
};

function ArchiveList({ workspaceId, manage }: Pick<Props, 'workspaceId' | 'manage'>) {
  const query = useQuery({
    queryKey: queryKeys.sessions(workspaceId, 'codex', true),
    queryFn: ({ signal }) => api.listSessions(workspaceId, 'codex', true, signal),
    retry: false,
  });
  const sessions = (query.data ?? []).filter(
    (session) => session.projectId === workspaceId && session.agent === 'codex',
  );
  if (query.isPending)
    return (
      <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
        正在读取 Codex 已归档会话…
      </p>
    );
  return (
    <div className="space-y-1">
      {query.isError && (
        <div className="space-y-1 px-2 py-1 text-xs">
          <p role="alert" className="text-destructive-foreground">
            归档会话读取失败：{query.error.message}
          </p>
          <button
            type="button"
            disabled={query.isFetching}
            className="rounded underline underline-offset-4"
            onClick={() => void query.refetch()}
          >
            重新读取归档会话
          </button>
        </div>
      )}
      {query.isSuccess && sessions.length === 0 && (
        <p className="px-2 py-1 text-xs text-muted-foreground">暂无 Codex 已归档会话</p>
      )}
      <ul className="flex flex-col gap-0.5">
        {sessions.map((session) => (
          <ProjectSessionRow
            key={session.sessionId}
            workspaceId={workspaceId}
            session={session}
            active={false}
            archived
            manage={(action) => manage(session, action, true)}
          />
        ))}
      </ul>
    </div>
  );
}

/** 归档查询只在用户展开此项目分组后挂载，收起时取消在途读取。 */
export function ProjectSessionArchive({ workspaceId, projectName, manage }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={`${projectName}的 Codex 已归档会话`} className="border-t border-border/50 pt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? '收起' : '显示'}“${projectName}”的 Codex 已归档会话`}
        onClick={() => setOpen(!open)}
        className="flex min-h-8 w-full items-center gap-1.5 rounded px-2 text-left text-xs text-muted-foreground hover:bg-muted/60"
      >
        <ChevronRight aria-hidden className={`size-3 shrink-0 ${open ? 'rotate-90' : ''}`} />
        <Archive aria-hidden className="size-3 shrink-0" />
        Codex 已归档
      </button>
      {open && <ArchiveList workspaceId={workspaceId} manage={manage} />}
    </section>
  );
}
