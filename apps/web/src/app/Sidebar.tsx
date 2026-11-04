import { Menu, MenuButton, MenuItem, useMenuStore } from '@ariakit/react';
import { ChevronRight, FolderPlus, Link2, Plus, Server } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { AgentKind, SessionSummary, Workspace } from '@agentdeck/shared';
import { AGENT_LABELS } from '../features/chat/AgentControls';
import { sessionActionKey, useChat } from '../features/chat/chat-store';
import { AgentBadge } from '../features/sessions/AgentBadge';
import { ProjectSessionRow as SessionRow } from '../features/sessions/ProjectSessionRow';
import { ProjectSessionArchive } from '../features/sessions/ProjectSessionArchive';
import { ProjectSessionDialog, type ProjectSessionSelection } from '../features/sessions/ProjectSessionDialog';
import type { SessionDialogAction } from '../features/sessions/SessionMenu';
import { buttonClass } from '../ui/styles';
import { ProjectMenu } from './ProjectMenu';
import { SessionRefreshControl } from '../features/sessions/SessionRefreshControl';
import {
  projectFolderName,
  useProjectChatBusy,
  type ProjectDraft,
  type ProjectManageAction,
} from './project-management';

export type SidebarProps = {
  pages?: ReactNode;
  projects: Workspace[];
  /** 按项目 id 归集的会话；未归属会话（projectId === null）可以混在其中，由侧栏裁决。 */
  sessionsByProject: Record<string, SessionSummary[]>;
  onAddProject(initial?: ProjectDraft): void;
  onManageProject?(project: Workspace, action: ProjectManageAction): void;
  onNewSession?(projectId: string, agent: AgentKind): void;
  onSelectProject?(projectId: string): void;
  onSelectSession?(projectId: string, session: SessionSummary): void;
  /** 绑定或修改服务器；不传时不显示绑定入口。 */
  onBindServer?(project: Workspace): void;
  /** 会话仍在读取时不要显示「暂无会话」，否则会把加载中误报成空列表。 */
  loadingSessions?: boolean;
  /** 测试与外部导航使用；不传时按 zustand 里的当前项目高亮。 */
  currentProjectId?: string;
};

const AGENT_ORDER: AgentKind[] = ['claude', 'codex', 'antigravity'];
function sessionGroups(sessions: SessionSummary[]) {
  return AGENT_ORDER.map((agent) => ({
    agent,
    sessions: sessions
      .filter((session) => session.agent === agent)
      .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
  })).filter((group) => group.sessions.length > 0);
}

function SessionGroup({
  agent,
  workspaceId,
  sessions,
  activeKey,
  select,
  manage,
}: {
  agent: AgentKind;
  workspaceId: string;
  sessions: SessionSummary[];
  activeKey: string;
  select?: (session: SessionSummary) => void;
  manage?: (session: SessionSummary, action: SessionDialogAction, archived: boolean) => void;
}) {
  return (
    <section aria-label={`${AGENT_LABELS[agent]} 会话`} className="space-y-0.5">
      <h3 className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground">
        <AgentBadge agent={agent} />
        <span>{AGENT_LABELS[agent]}</span>
        <span className="font-normal tabular-nums">{sessions.length}</span>
      </h3>
      <ul className="flex flex-col gap-0.5">
        {sessions.map((session) => (
          <SessionRow
            key={session.sessionId}
            session={session}
            workspaceId={workspaceId}
            active={activeKey === sessionActionKey(session.projectId ?? '', session)}
            select={select ? () => select(session) : undefined}
            manage={manage ? (action) => manage(session, action, false) : undefined}
          />
        ))}
      </ul>
    </section>
  );
}

function ProjectItem({
  project,
  sessions,
  expanded,
  current,
  loading,
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
  activeKey: string;
  toggle(): void;
  selectSession?: (session: SessionSummary) => void;
  manageSession: (session: SessionSummary, action: SessionDialogAction, archived: boolean) => void;
  onBindServer?(project: Workspace): void;
  onManageProject?(project: Workspace, action: ProjectManageAction): void;
}) {
  const groups = sessionGroups(sessions);
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-current={current ? 'true' : undefined}
        title={project.dir}
        className="group flex min-h-9 w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] text-foreground hover:bg-muted/60 aria-[current]:bg-muted"
        onClick={toggle}
      >
        <ChevronRight
          aria-hidden
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
        {project.server && (
          <span className="shrink-0" title={`已绑定服务器 ${project.server}`}>
            <Server aria-hidden className="size-3 text-accent" />
          </span>
        )}
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{sessions.length}</span>
      </button>
      <ProjectMetadata
        project={project}
        running={sessions.some((session) => session.running)}
        onBindServer={onBindServer}
        onManageProject={onManageProject}
      />
      {expanded && (
        <div className="mt-1 mb-2 space-y-1 pl-2">
          {groups.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">{loading ? '正在读取会话…' : '暂无会话'}</p>
          ) : (
            groups.map((group) => (
              <SessionGroup
                key={group.agent}
                agent={group.agent}
                workspaceId={project.id}
                sessions={group.sessions}
                activeKey={activeKey}
                select={selectSession}
                manage={manageSession}
              />
            ))
          )}
          <ProjectSessionArchive workspaceId={project.id} projectName={project.name} manage={manageSession} />
        </div>
      )}
    </li>
  );
}

function ProjectMetadata({
  project,
  running,
  onBindServer,
  onManageProject,
}: {
  project: Workspace;
  running: boolean;
  onBindServer?: SidebarProps['onBindServer'];
  onManageProject?: SidebarProps['onManageProject'];
}) {
  return (
    <div className="flex min-w-0 items-center gap-1 pl-7">
      <p
        className="min-w-0 flex-1 truncate font-mono text-[10px] leading-4 text-muted-foreground/80"
        title={project.dir}
      >
        {project.dir}
      </p>
      {onManageProject && (
        <ProjectMenu project={project} running={running} choose={(action) => onManageProject(project, action)} />
      )}
      {onBindServer && (
        <button
          type="button"
          aria-label={project.server ? `修改“${project.name}”的服务器绑定` : `给“${project.name}”绑定服务器`}
          title={project.server ? '修改服务器绑定' : '绑定服务器'}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => onBindServer(project)}
        >
          <Link2 aria-hidden className="size-3" />
        </button>
      )}
    </div>
  );
}

function NewSessionMenu({
  projects,
  currentProjectId,
  onNewSession,
}: Pick<SidebarProps, 'projects' | 'onNewSession'> & { currentProjectId?: string }) {
  const menu = useMenuStore({ placement: 'bottom-start' });
  const target = projects.find((project) => project.id === currentProjectId) ?? projects[0];
  if (!target)
    return (
      <button type="button" className={`${buttonClass('ghost')} min-h-8 gap-1.5 px-2`} disabled title="先添加项目目录">
        <Plus aria-hidden className="size-4" />
        新建会话
      </button>
    );
  return (
    <>
      <MenuButton
        store={menu}
        render={<button type="button" />}
        className={`${buttonClass('ghost')} min-h-8 gap-1.5 px-2`}
        aria-label="新建会话"
        title="选择 CLI 后开始新会话"
      >
        <Plus aria-hidden className="size-4" />
        新建会话
      </MenuButton>
      <Menu
        store={menu}
        portal
        unmountOnHide
        gutter={6}
        aria-label="选择 CLI"
        className="z-50 min-w-44 rounded-xl border border-border-strong bg-card p-1.5 text-foreground shadow-xl"
      >
        <p className="px-3 py-1.5 text-xs text-muted-foreground">在 {target.name} 新建</p>
        {AGENT_ORDER.map((agent) => (
          <MenuItem
            key={agent}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-active-item:bg-muted data-active-item:ring-1 data-active-item:ring-accent"
            onClick={() => {
              menu.hide();
              onNewSession?.(target.id, agent);
            }}
          >
            <AgentBadge agent={agent} />
            {AGENT_LABELS[agent]}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function OtherSessions({
  sessions,
  activeKey,
  addProject,
}: {
  sessions: SessionSummary[];
  activeKey: string;
  addProject(initial?: ProjectDraft): void;
}) {
  const busy = useProjectChatBusy();
  return (
    <section aria-label="其他目录的会话" className="border-t border-border/70 pt-2">
      <div className="flex items-center gap-1.5 px-2 py-1">
        <h3 className="min-w-0 flex-1 text-[11px] font-semibold text-muted-foreground">
          其他目录 <span className="font-normal tabular-nums">{sessions.length}</span>
        </h3>
      </div>
      <ul className="flex flex-col gap-0.5">
        {sessions.map((session) => (
          <li key={`${session.agent}:${session.sessionId}`} className="min-w-0">
            <ul>
              <SessionRow session={session} active={activeKey === sessionActionKey(session.projectId ?? '', session)} />
            </ul>
            {session.directory && (
              <div className="flex min-w-0 items-center gap-1 pl-2">
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

/** 左栏只负责展示与选择；项目与会话数据由外壳读取后传入，未归属会话默认隐藏。 */
export function Sidebar({
  pages,
  projects,
  sessionsByProject,
  onAddProject,
  onNewSession,
  onSelectProject,
  onSelectSession,
  onBindServer,
  onManageProject,
  loadingSessions = false,
  currentProjectId,
}: SidebarProps) {
  const chatProjectId = useChat((state) => state.workspaceId);
  const chatAgent = useChat((state) => state.agent);
  const chatSessionId = useChat((state) => state.sessionId);
  const selectedProject = currentProjectId ?? chatProjectId;
  // 展开状态只记用户显式切换过的项目：当前项目与首个项目默认展开，切换项目时自动跟上。
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const defaultExpanded = selectedProject ?? projects[0]?.id;
  const isExpanded = (projectId: string) => toggled[projectId] ?? projectId === defaultExpanded;
  const [showOtherSessions, setShowOtherSessions] = useState(false);
  // 原生管理的项目身份固定取自被点击的行，界面选择变化不改写目标。
  const [managing, setManaging] = useState<ProjectSessionSelection | undefined>(undefined);
  const activeKey = useMemo(
    () =>
      chatSessionId && chatProjectId
        ? sessionActionKey(chatProjectId, { agent: chatAgent, sessionId: chatSessionId })
        : '',
    [chatAgent, chatProjectId, chatSessionId],
  );
  const projectSessions = useMemo(
    () =>
      Object.fromEntries(
        projects.map((project) => [
          project.id,
          (sessionsByProject[project.id] ?? []).filter((session) => session.projectId === project.id),
        ]),
      ) as Record<string, SessionSummary[]>,
    [projects, sessionsByProject],
  );
  const otherSessions = useMemo(() => {
    const seen = new Set<string>();
    return Object.values(sessionsByProject)
      .flat()
      .filter((session) => {
        if (session.projectId !== null) return false;
        const key = `${session.agent}:${session.sessionId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [sessionsByProject]);
  // 点未选中的项目＝切过去并展开；再点当前项目才收起，避免展开动作顺手清掉对话。
  const toggle = (projectId: string) => {
    const expanded = isExpanded(projectId);
    const isCurrent = projectId === selectedProject;
    if (!isCurrent) onSelectProject?.(projectId);
    setToggled((previous) => ({ ...previous, [projectId]: !(isCurrent && expanded) }));
  };
  return (
    <nav aria-label="项目与会话" className="flex h-full min-h-0 flex-col bg-card text-foreground">
      {pages}
      <header className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/70 px-2 py-2">
        <h2 className="mr-auto shrink-0 px-1 text-xs font-semibold tracking-wide text-muted-foreground">项目</h2>
        <SessionRefreshControl />
        <NewSessionMenu projects={projects} currentProjectId={selectedProject} onNewSession={onNewSession} />
        <button
          type="button"
          className={`${buttonClass('ghost')} min-h-8 px-2`}
          aria-label="添加项目"
          title="添加项目目录"
          onClick={() => onAddProject()}
        >
          <FolderPlus aria-hidden className="size-4" />
        </button>
      </header>
      {projects.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
          <FolderPlus aria-hidden className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">还没有项目</p>
          <p className="text-xs leading-5 text-muted-foreground">添加一个本地项目目录，按 CLI 查看本机会话。</p>
          <button type="button" className={buttonClass('outline')} onClick={() => onAddProject()}>
            添加项目目录
          </button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <ul className="flex flex-col gap-1">
            {projects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                sessions={projectSessions[project.id] ?? []}
                expanded={isExpanded(project.id)}
                current={selectedProject === project.id}
                loading={loadingSessions}
                activeKey={activeKey}
                toggle={() => toggle(project.id)}
                selectSession={onSelectSession ? (session) => onSelectSession(project.id, session) : undefined}
                manageSession={(session, action, archived) =>
                  setManaging({ workspaceId: project.id, session, action, archived })
                }
                onBindServer={onBindServer}
                onManageProject={onManageProject}
              />
            ))}
          </ul>
          {showOtherSessions && otherSessions.length > 0 && (
            <OtherSessions sessions={otherSessions} activeKey={activeKey} addProject={onAddProject} />
          )}
        </div>
      )}
      <footer className="flex shrink-0 items-center border-t border-border/70 px-3 py-2">
        <label className="flex min-h-7 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            role="switch"
            checked={showOtherSessions}
            onChange={(event) => setShowOtherSessions(event.target.checked)}
            className="size-3.5 accent-accent"
          />
          显示其他目录的会话
        </label>
      </footer>
      {managing && (
        <ProjectSessionDialog
          key={JSON.stringify([
            managing.workspaceId,
            managing.session.agent,
            managing.session.sessionId,
            managing.action,
          ])}
          selected={managing}
          sessions={projectSessions[managing.workspaceId] ?? []}
          close={() => setManaging(undefined)}
        />
      )}
    </nav>
  );
}
