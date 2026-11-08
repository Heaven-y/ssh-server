import { Folder, FolderOpen, FolderPlus } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AgentKind, SessionSummary } from '@agentdeck/shared/conversation';
import type { Workspace } from '@agentdeck/shared/projects';
import { AGENT_LABELS } from '../cli/shared/labels';
import { sessionActionKey, useChat } from '../features/chat/chat-store';
import { SortableSessionRow as SessionRow } from '../features/sessions/SortableSessionRow';
import { sessionOrderKey, sortSessions, useSessionOrder } from '../features/sessions/session-order';
import { ProjectSessionDialog, type ProjectSessionSelection } from '../features/sessions/ProjectSessionDialog';
import type { SessionDialogAction } from '../features/sessions/SessionMenu';
import { buttonClass } from '../ui/styles';
import { useUiPreferences } from '../ui/ui-preferences';
import { ProjectMenu } from '../features/projects/ProjectMenu';
import { NewSessionMenu, SidebarMore } from './SidebarActions';
import { SidebarBrand, SidebarFooter, SidebarWorkspaces } from './SidebarChrome';
import { SidebarOtherSessions } from './SidebarOtherSessions';
import type { ProjectDraft, ProjectManageAction } from '../features/projects/project-management';
import type { SessionListFailure } from '../features/projects/use-project-sessions';
import { LoadMoreSessions } from '../features/sessions/LoadMoreSessions';
import { BackgroundConversations } from '../features/chat/BackgroundConversations';

export type SidebarProps = {
  pages?: ReactNode;
  search?: string;
  onSearch?(value: string): void;
  sessionPages?: { hasMore: boolean; loadingMore: boolean; more(): void };
  otherPages?: { hasMore: boolean; loadingMore: boolean; more(): void };
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
  onOpenConversation?(id: string): void;
  /** 会话仍在读取时不要把加载中误报成空列表。 */
  loadingSessions?: boolean;
  currentProjectId?: string;
};

const EMPTY_SESSIONS: SessionSummary[] = [];
const EMPTY_FAILURES: SessionListFailure[] = [];
const agentSearchNames = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity AGY' };
const newestFirst = (a: SessionSummary, b: SessionSummary) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
const matchesSession = (session: SessionSummary, query: string) =>
  `${session.title} ${session.sessionId} ${session.directory ?? ''} ${AGENT_LABELS[session.agent]} ${agentSearchNames[session.agent]}`
    .toLocaleLowerCase()
    .includes(query);

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
  incomplete,
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
  incomplete: boolean;
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
  const FolderIcon = expanded ? FolderOpen : Folder;
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
          <FolderIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
          <span title="已加载会话数" className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {sessions.length}
          </span>
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
          <ProjectSessionStatus
            loading={loading}
            incomplete={incomplete}
            empty={sessions.length === 0}
            failures={failures}
            retry={retry}
          />
          {sessions.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {sessions.map((session) => (
                <SessionRow
                  key={`${session.agent}:${session.sessionId}`}
                  session={session}
                  sessions={sessions}
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
  incomplete,
  empty,
  failures,
  retry,
}: {
  loading: boolean;
  incomplete: boolean;
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
  if (!empty || incomplete) return null;
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
  incomplete,
  addProject,
}: {
  projects: Workspace[];
  visibleCount: number;
  incomplete: boolean;
  addProject(): void;
}) {
  if (projects.length === 0) return <EmptyProjects addProject={addProject} />;
  if (visibleCount > 0 || incomplete) return null;
  return <p className="px-3 py-5 text-xs text-muted-foreground">没有匹配的工作区或会话</p>;
}

function useSidebarSelection(projects: Workspace[], currentProjectId?: string) {
  const chatProjectId = useChat((state) => state.workspaceId);
  const conversationId = useChat((state) => state.conversationId);
  const [focused, setFocused] = useState<{ projectId: string; conversationId: string }>();
  const selectedProject =
    focused?.conversationId === conversationId ? focused.projectId : (currentProjectId ?? chatProjectId);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const defaultExpanded = currentProjectId ?? chatProjectId ?? projects[0]?.id;
  if (defaultExpanded && toggled[defaultExpanded] === undefined) setToggled({ ...toggled, [defaultExpanded]: true });
  const isExpanded = (projectId: string) => toggled[projectId] ?? projectId === defaultExpanded;
  const activeKey = useChat((state) => {
    if (!state.workspaceId || !state.sessionId) return '';
    return sessionActionKey(state.workspaceId, { agent: state.agent, sessionId: state.sessionId });
  });
  return {
    selectedProject,
    activeKey,
    isExpanded,
    toggle(projectId: string) {
      const collapse = isExpanded(projectId);
      setFocused({ projectId, conversationId });
      setToggled((previous) => ({ ...previous, [projectId]: !collapse }));
    },
  };
}
function useSidebarSearch(controlled?: string, change?: (value: string) => void) {
  const [local, setLocal] = useState('');
  return [controlled ?? local, change ?? setLocal] as const;
}
function MoreSessions({ page }: { page?: SidebarProps['sessionPages'] }) {
  return page ? <LoadMoreSessions {...page} loading={page.loadingMore} /> : null;
}

/** 左栏只读取摘要与导航；原生会话写操作始终使用被点击行的完整身份。 */
export function Sidebar({
  pages,
  search: controlledSearch,
  onSearch,
  sessionPages,
  otherPages,
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
  onOpenConversation,
  loadingSessions = false,
  currentProjectId,
}: SidebarProps) {
  const collapsed = useUiPreferences((state) => state.sidebarCollapsed || state.sidebarAutoCollapsed);
  const selection = useSidebarSelection(projects, currentProjectId);
  const [search, setSearch] = useSidebarSearch(controlledSearch, onSearch);
  const query = search.trim().toLocaleLowerCase();
  const [showOtherSessions, setShowOtherSessions] = useState(false);
  const [managing, setManaging] = useState<ProjectSessionSelection | undefined>(undefined);
  const sortMode = useSessionOrder((state) => state.mode);
  const orders = useSessionOrder((state) => state.orders);
  const knownOrder = useSessionOrder((state) => state.known);
  const rememberOrder = useSessionOrder((state) => state.remember);
  const projectSessions = useMemo(
    () =>
      Object.fromEntries(
        projects.map((project) => [
          project.id,
          sortSessions(
            (sessionsByProject[project.id] ?? EMPTY_SESSIONS).filter((session) => session.projectId === project.id),
            sortMode,
            orders[project.id] ?? knownOrder[project.id],
          ),
        ]),
      ) as Record<string, SessionSummary[]>,
    [projects, sessionsByProject, sortMode, orders, knownOrder],
  );
  useEffect(() => {
    for (const [project, sessions] of Object.entries(projectSessions))
      rememberOrder(project, sessions.map(sessionOrderKey), !!query);
  }, [projectSessions, rememberOrder, query]);
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
      <div className="flex shrink-0 flex-col gap-0.5 pt-1">
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
      <BackgroundConversations projects={projects} collapsed={collapsed} open={onOpenConversation} />
      <SidebarWorkspaces
        collapsed={collapsed}
        query={search}
        changeQuery={setSearch}
        addProject={() => onAddProject()}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!collapsed && (
          <>
            <WorkspaceListNotice
              projects={projects}
              visibleCount={visible.length}
              incomplete={Boolean(sessionPages?.hasMore)}
              addProject={() => onAddProject()}
            />
            <ul className="flex flex-col gap-0.5">
              {visible.map(({ project, sessions }) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  sessions={sessions}
                  expanded={Boolean(query) || selection.isExpanded(project.id)}
                  current={selection.selectedProject === project.id}
                  loading={loadingSessions}
                  incomplete={Boolean(sessionPages?.hasMore)}
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
            <MoreSessions page={sessionPages} />
            {showOtherSessions && (
              <>
                <SidebarOtherSessions
                  sessions={otherSessions.filter((session) => matchesSession(session, query))}
                  activeKey={selection.activeKey}
                  addProject={onAddProject}
                  loading={loadingOtherSessions}
                  incomplete={Boolean(otherPages?.hasMore)}
                  error={otherSessionsError}
                />
                <MoreSessions page={otherPages} />
              </>
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
