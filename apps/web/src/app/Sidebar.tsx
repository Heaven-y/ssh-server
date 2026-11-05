import { ChevronRight, FolderPlus } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { AgentKind, SessionSummary, Workspace } from '@agentdeck/shared';
import { AGENT_LABELS } from '../features/chat/AgentControls';
import { sessionActionKey, useChat } from '../features/chat/chat-store';
import { ProjectSessionRow as SessionRow } from '../features/sessions/ProjectSessionRow';
import { ProjectSessionDialog, type ProjectSessionSelection } from '../features/sessions/ProjectSessionDialog';
import type { SessionDialogAction } from '../features/sessions/SessionMenu';
import { buttonClass } from '../ui/styles';
import { useUiPreferences } from '../ui/ui-preferences';
import { ProjectMenu } from './ProjectMenu';
import { NewSessionMenu, SidebarMore } from './SidebarActions';
import { SidebarBrand, SidebarFooter, SidebarWorkspaces } from './SidebarChrome';
import { SidebarOtherSessions } from './SidebarOtherSessions';
import type { ProjectDraft, ProjectManageAction } from './project-management';
import type { SessionListFailure } from './use-project-sessions';

export type SidebarProps = {
  pages?: ReactNode;
  projects: Workspace[];
  /** 按项目 id 归集的会话；未归属会话由侧栏去重后按需展示。 */
  sessionsByProject: Record<string, SessionSummary[]>;
  sessionErrorsByProject?: Record<string, SessionListFailure[]>;
  onRetrySessions?(projectId: string): void;
  otherSessions?: SessionSummary[];
  loadingOtherSessions?: boolean;
  otherSessionsError?: string;
  onShowOtherSessions?(show: boolean): void;
  onAddProject(initial?: ProjectDraft): void;
  onManageProject?(project: Workspace, action: ProjectManageAction): void;
  onNewSession?(projectId: string, agent: AgentKind): void;
  onSelectProject?(projectId: string): void;
  onSelectSession?(projectId: string, session: SessionSummary): void;
  onBindServer?(project: Workspace): void;
  onOpenSettings?(): void;
  onOpenCommands?(): void;
  onOpenArchive?(): void;
  /** 会话仍在读取时不要把加载中误报成空列表。 */
  loadingSessions?: boolean;
  currentProjectId?: string;
};

const EMPTY_SESSIONS: SessionSummary[] = [];
const EMPTY_FAILURES: SessionListFailure[] = [];
const newestFirst = (a: SessionSummary, b: SessionSummary) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
const matchesSession = (session: SessionSummary, query: string) =>
  `${session.title} ${AGENT_LABELS[session.agent]}`.toLocaleLowerCase().includes(query);

function unassignedSessions(sessions: Record<string, SessionSummary[]>, extra: SessionSummary[]) {
  const entries = new Map<string, SessionSummary>();
  for (const session of [...Object.values(sessions).flat(), ...extra]) {
    if (session.projectId === null) entries.set(`${session.agent}:${session.sessionId}`, session);
  }
  return [...entries.values()].toSorted(newestFirst);
}

function visibleProjects(projects: Workspace[], sessions: Record<string, SessionSummary[]>, query: string) {
  return projects.flatMap((project) => {
    const items = sessions[project.id] ?? EMPTY_SESSIONS;
    const matchesProject = `${project.name} ${project.dir}`.toLocaleLowerCase().includes(query);
    const visible = matchesProject ? items : items.filter((session) => matchesSession(session, query));
    return matchesProject || visible.length > 0 ? [{ project, sessions: visible }] : [];
  });
}

function ProjectItem({
  project,
  sessions,
  expanded,
  current,
  loading,
  failures,
  retry,
  running,
  activeKey,
  toggle,
  selectSession,
  manageSession,
  onBindServer,
  onManageProject,
}: {
  project: Workspace;
  sessions: SessionSummary[];
  expanded: boolean;
  current: boolean;
  loading: boolean;
  failures: SessionListFailure[];
  retry?: () => void;
  running: boolean;
  activeKey: string;
  toggle(): void;
  selectSession?: (session: SessionSummary) => void;
  manageSession: (session: SessionSummary, action: SessionDialogAction, archived: boolean) => void;
  onBindServer?: SidebarProps['onBindServer'];
  onManageProject?: SidebarProps['onManageProject'];
}) {
  return (
    <li className="min-w-0">
      <div className="group flex min-w-0 items-center rounded-lg hover:bg-muted/70">
        <button
          type="button"
          aria-expanded={expanded}
          aria-current={current ? 'true' : undefined}
          title={project.dir}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1 text-left text-[13px] text-foreground focus-visible:outline-2 focus-visible:outline-accent"
          onClick={toggle}
        >
          <ChevronRight
            aria-hidden
            className={`size-3.5 shrink-0 text-muted-foreground motion-safe:transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{sessions.length}</span>
        </button>
        <ProjectMenu
          project={project}
          running={running}
          choose={onManageProject ? (action) => onManageProject(project, action) : undefined}
          bindServer={onBindServer ? () => onBindServer(project) : undefined}
        />
      </div>
      {expanded && (
        <section aria-label={`${project.name}会话`} className="mb-2 pl-3">
          <ProjectSessionStatus loading={loading} empty={sessions.length === 0} failures={failures} retry={retry} />
          {sessions.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {sessions.map((session) => (
                <SessionRow
                  key={`${session.agent}:${session.sessionId}`}
                  session={session}
                  workspaceId={project.id}
                  active={activeKey === sessionActionKey(project.id, session)}
                  select={selectSession ? () => selectSession(session) : undefined}
                  manage={(action) => manageSession(session, action, false)}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </li>
  );
}

function ProjectSessionStatus({
  loading,
  empty,
  failures,
  retry,
}: {
  loading: boolean;
  empty: boolean;
  failures: SessionListFailure[];
  retry?: () => void;
}) {
  if (failures.length > 0)
    return (
      <div className="space-y-1 px-3 py-2 text-xs">
        {failures.map((failure) => (
          <p key={failure.agent} role="alert" className="break-words leading-5 text-destructive-foreground">
            {AGENT_LABELS[failure.agent]}：{failure.message}
          </p>
        ))}
        {retry && (
          <button type="button" className="min-h-8 rounded underline underline-offset-4" onClick={retry}>
            重新读取会话
          </button>
        )}
      </div>
    );
  if (!empty) return null;
  return (
    <p role={loading ? 'status' : undefined} className="px-3 py-2 text-xs text-muted-foreground">
      {loading ? '正在读取会话…' : '暂无会话'}
    </p>
  );
}

function EmptyProjects({ addProject }: { addProject(): void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-5 py-10 text-center">
      <FolderPlus aria-hidden className="size-7 text-muted-foreground" />
      <p className="text-sm font-medium">还没有项目</p>
      <p className="text-xs leading-5 text-muted-foreground">添加一个本地目录，查看与继续原生 CLI 会话。</p>
      <button type="button" className={buttonClass('outline')} onClick={addProject}>
        添加项目目录
      </button>
    </div>
  );
}

function WorkspaceListNotice({
  projects,
  visibleCount,
  addProject,
}: {
  projects: Workspace[];
  visibleCount: number;
  addProject(): void;
}) {
  if (projects.length === 0) return <EmptyProjects addProject={addProject} />;
  if (visibleCount > 0) return null;
  return <p className="px-3 py-5 text-xs text-muted-foreground">没有匹配的工作区或会话</p>;
}

function useSidebarSelection(projects: Workspace[], currentProjectId?: string) {
  const chatProjectId = useChat((state) => state.workspaceId);
  const chatAgent = useChat((state) => state.agent);
  const chatSessionId = useChat((state) => state.sessionId);
  const selectedProject = currentProjectId ?? chatProjectId;
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const defaultExpanded = selectedProject ?? projects[0]?.id;
  const isExpanded = (projectId: string) => toggled[projectId] ?? projectId === defaultExpanded;
  const activeKey =
    chatSessionId && chatProjectId
      ? sessionActionKey(chatProjectId, { agent: chatAgent, sessionId: chatSessionId })
      : '';
  return {
    selectedProject,
    activeKey,
    isExpanded,
    toggle(projectId: string) {
      const collapse = projectId === selectedProject && isExpanded(projectId);
      setToggled((previous) => ({ ...previous, [projectId]: !collapse }));
    },
  };
}

/** 左栏只读取摘要与导航；原生会话写操作始终使用被点击行的完整身份。 */
export function Sidebar({
  pages,
  projects,
  sessionsByProject,
  sessionErrorsByProject,
  onRetrySessions,
  otherSessions: extraSessions = EMPTY_SESSIONS,
  loadingOtherSessions = false,
  otherSessionsError,
  onShowOtherSessions,
  onAddProject,
  onNewSession,
  onSelectProject,
  onSelectSession,
  onBindServer,
  onManageProject,
  onOpenSettings,
  onOpenCommands,
  onOpenArchive,
  loadingSessions = false,
  currentProjectId,
}: SidebarProps) {
  const collapsed = useUiPreferences((state) => state.sidebarCollapsed || state.sidebarAutoCollapsed);
  const selection = useSidebarSelection(projects, currentProjectId);
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const [showOtherSessions, setShowOtherSessions] = useState(false);
  const [managing, setManaging] = useState<ProjectSessionSelection | undefined>(undefined);
  const projectSessions = useMemo(
    () =>
      Object.fromEntries(
        projects.map((project) => [
          project.id,
          (sessionsByProject[project.id] ?? EMPTY_SESSIONS)
            .filter((session) => session.projectId === project.id)
            .toSorted(newestFirst),
        ]),
      ) as Record<string, SessionSummary[]>,
    [projects, sessionsByProject],
  );
  const otherSessions = useMemo(
    () => unassignedSessions(sessionsByProject, extraSessions),
    [sessionsByProject, extraSessions],
  );
  const visible = useMemo(() => visibleProjects(projects, projectSessions, query), [projects, projectSessions, query]);
  const showOther = (show: boolean) => {
    setShowOtherSessions(show);
    onShowOtherSessions?.(show);
    if (show && collapsed) useUiPreferences.getState().setSidebarCollapsed(false);
  };
  return (
    <nav aria-label="项目与会话" className="flex h-full min-h-0 flex-col bg-sidebar p-2 text-foreground">
      <SidebarBrand collapsed={collapsed} />
      <div className="shrink-0 space-y-0.5 pt-1">
        <NewSessionMenu
          projects={projects}
          currentProjectId={selection.selectedProject}
          onNewSession={onNewSession}
          onAddProject={() => onAddProject()}
          collapsed={collapsed}
        />
        {pages}
        <SidebarMore
          collapsed={collapsed}
          showOtherSessions={showOtherSessions}
          setShowOtherSessions={showOther}
          onOpenCommands={onOpenCommands}
          onOpenArchive={onOpenArchive}
        />
      </div>
      <SidebarWorkspaces
        collapsed={collapsed}
        query={search}
        changeQuery={setSearch}
        addProject={() => onAddProject()}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!collapsed && (
          <>
            <WorkspaceListNotice projects={projects} visibleCount={visible.length} addProject={() => onAddProject()} />
            <ul className="flex flex-col gap-0.5">
              {visible.map(({ project, sessions }) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  sessions={sessions}
                  expanded={Boolean(query) || selection.isExpanded(project.id)}
                  current={selection.selectedProject === project.id}
                  loading={loadingSessions}
                  failures={sessionErrorsByProject?.[project.id] ?? EMPTY_FAILURES}
                  retry={onRetrySessions ? () => onRetrySessions(project.id) : undefined}
                  running={projectSessions[project.id]!.some((session) => session.running)}
                  activeKey={selection.activeKey}
                  toggle={() => {
                    onSelectProject?.(project.id);
                    selection.toggle(project.id);
                  }}
                  selectSession={onSelectSession ? (session) => onSelectSession(project.id, session) : undefined}
                  manageSession={(session, action, archived) =>
                    setManaging({ workspaceId: project.id, session, action, archived })
                  }
                  onBindServer={onBindServer}
                  onManageProject={onManageProject}
                />
              ))}
            </ul>
            {showOtherSessions && (
              <SidebarOtherSessions
                sessions={otherSessions.filter((session) => matchesSession(session, query))}
                activeKey={selection.activeKey}
                addProject={onAddProject}
                loading={loadingOtherSessions}
                error={otherSessionsError}
              />
            )}
          </>
        )}
      </div>
      <SidebarFooter collapsed={collapsed} onOpenSettings={onOpenSettings} />
      {managing && (
        <ProjectSessionDialog
          key={JSON.stringify([
            managing.workspaceId,
            managing.session.agent,
            managing.session.sessionId,
            managing.action,
          ])}
          selected={managing}
          sessions={projectSessions[managing.workspaceId] ?? EMPTY_SESSIONS}
          close={() => setManaging(undefined)}
        />
      )}
    </nav>
  );
}
