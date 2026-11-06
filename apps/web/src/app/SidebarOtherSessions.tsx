import type { SessionSummary } from '@agentdeck/shared/conversation';
import { sessionActionKey } from '../features/chat/chat-store';
import { ProjectSessionRow } from '../features/sessions/ProjectSessionRow';
import { buttonClass } from '../ui/styles';
import { projectFolderName, useProjectChatBusy, type ProjectDraft } from '../features/projects/project-management';

export function SidebarOtherSessions({
  sessions,
  activeKey,
  addProject,
  loading,
  error,
}: {
  sessions: SessionSummary[];
  activeKey: string;
  addProject(initial?: ProjectDraft): void;
  loading: boolean;
  error?: string;
}) {
  const busy = useProjectChatBusy();
  return (
    <section aria-label="其他目录的会话" className="mt-2 border-t border-border/70 pt-2">
      <h3 className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground">
        其他目录 <span className="font-normal tabular-nums">{sessions.length}</span>
      </h3>
      {loading && (
        <p role="status" className="px-3 py-1 text-xs text-muted-foreground">
          正在读取其他目录的会话…
        </p>
      )}
      {error && (
        <p role="alert" className="px-3 py-1 text-xs text-destructive-foreground">
          {error}
        </p>
      )}
      {!loading && !error && sessions.length === 0 && (
        <p className="px-3 py-1 text-xs text-muted-foreground">暂无其他目录的会话</p>
      )}
      <ul className="flex flex-col gap-0.5">
        {sessions.map((session) => (
          <li key={`${session.agent}:${session.sessionId}`} className="min-w-0">
            <ul>
              <ProjectSessionRow session={session} active={activeKey === sessionActionKey('', session)} />
            </ul>
            {session.directory && (
              <div className="flex min-w-0 items-center gap-1 pl-3">
                <p
                  className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground"
                  title={session.directory}
                >
                  {session.directory}
                </p>
                <button
                  type="button"
                  className={`${buttonClass('ghost')} min-h-7 shrink-0 px-2 text-[11px]`}
                  disabled={busy || session.running}
                  aria-label={`将“${session.title || '未命名会话'}”所在目录加为项目`}
                  onClick={() => addProject({ dir: session.directory, name: projectFolderName(session.directory!) })}
                >
                  加为项目
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
