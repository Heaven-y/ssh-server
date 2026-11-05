import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import type { AgentKind, SessionSummary, Workspace } from '@agentdeck/shared';
import { allowConversationNavigation, useChat } from '../features/chat/chat-store';
import { api, queryKeys } from '../lib/api';
import { TopBar } from './TopBar';
import { useProductSettings } from '../features/settings/use-product-settings';
import { useUiPreferences } from '../ui/ui-preferences';
import { useCommandPalette } from './use-command-palette';
import type { PaletteActions } from './CommandPalette';
import { ServerManagerDialog } from '../features/ssh/ServerManagerDialog';
import { EnvironmentSummary } from '../features/settings/EnvironmentReport';
import { Sidebar } from './Sidebar';
import { SessionPane } from './SessionPane';
import { ConversationSidebar } from './ConversationSidebar';
import { WorkspaceLayout } from './WorkspaceLayout';
import { useProjectNavigation } from './use-project-navigation';
import { useOtherSessions, useProjectSessions } from './use-project-sessions';
import { useConversationSidebar } from './use-conversation-sidebar';
import { AddProjectDialog } from './AddProjectDialog';
import { BindServerDialog } from './BindServerDialog';
import { ProjectManageDialog } from './ProjectManageDialog';
import type { ProjectDraft, ProjectManageAction } from './project-management';
import { PluginNavigation } from '../features/plugins/PluginNavigation';
import { PluginWorkspace } from '../features/plugins/PluginWorkspace';
import { usePluginPages } from '../features/plugins/use-plugin-pages';
import { DesktopTitleBar } from './DesktopTitleBar';

const SettingsDialog = lazy(() => import('../features/settings/SettingsDialog'));
const CommandPalette = lazy(() => import('./CommandPalette'));
const PluginManager = lazy(() => import('../features/plugins/PluginManager'));
const ArchivedSessionsPage = lazy(() => import('../features/sessions/ArchivedSessionsPage'));

function OpenPluginManager({ opened, close }: { opened: boolean; close(): void }) {
  return (
    opened && (
      <Suspense fallback={<p role="status">正在打开插件管理…</p>}>
        <PluginManager onClose={close} />
      </Suspense>
    )
  );
}

function OpenPalette({
  opened,
  workspace,
  workspaces,
  actions,
  close,
}: {
  opened: boolean;
  workspace?: Workspace;
  workspaces?: Workspace[];
  actions: PaletteActions;
  close(): void;
}) {
  return (
    opened && (
      <Suspense
        fallback={
          <p role="status" className="p-3 text-sm">
            正在打开命令面板…
          </p>
        }
      >
        <CommandPalette
          key={workspace?.id ?? 'none'}
          workspaces={workspaces ?? []}
          workspace={workspace}
          actions={actions}
          close={close}
        />
      </Suspense>
    )
  );
}

function OpenSettings({ opened, project, close }: { opened: boolean; project?: Workspace; close(): void }) {
  return (
    opened && (
      <Suspense
        fallback={
          <p role="status" className="absolute right-4 top-14 z-50 rounded-md border border-border bg-card p-3 text-sm">
            正在打开设置…
          </p>
        }
      >
        <SettingsDialog key={project?.id ?? 'none'} project={project} onClose={close} />
      </Suspense>
    )
  );
}

function ProjectDialogs({
  adding,
  binding,
  managing,
  closeAdd,
  closeBind,
  closeManage,
}: {
  adding?: ProjectDraft;
  binding?: Workspace;
  managing?: { project: Workspace; action: ProjectManageAction };
  closeAdd(): void;
  closeBind(): void;
  closeManage(): void;
}) {
  return (
    <>
      {adding && <AddProjectDialog initialDir={adding.dir} initialName={adding.name} onClose={closeAdd} />}
      {binding && <BindServerDialog project={binding} onClose={closeBind} />}
      {managing && <ProjectManageDialog {...managing} onClose={closeManage} />}
    </>
  );
}

/** 工作区导航贯穿左列；会话与插件使用中间主区，右侧上下文按需打开。 */
export function App() {
  const palette = useCommandPalette();
  const theme = useUiPreferences((state) => state.theme);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const productSettings = useProductSettings();
  const setDefaults = useChat((s) => s.setDefaults);
  useEffect(() => {
    if (productSettings.data) setDefaults(productSettings.data.settings);
  }, [productSettings.data, setDefaults]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const plugins = usePluginPages();
  const activePlugin = plugins.active;
  const [archiveOpen, setArchiveOpen] = useState(false);
  const showPlugin = (id?: string) => {
    if (!allowConversationNavigation()) return;
    setArchiveOpen(false);
    plugins.show(id);
  };
  const showArchive = () => {
    if (!allowConversationNavigation()) return;
    plugins.show(undefined);
    setArchiveOpen(true);
  };
  const closeArchive = () => {
    setArchiveOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('button[aria-label="更多"]')?.focus());
  };
  const [serversOpen, setServersOpen] = useState(false);
  const [addingProject, setAddingProject] = useState<ProjectDraft>();
  const [managingProject, setManagingProject] = useState<{ project: Workspace; action: ProjectManageAction }>();
  // 绑定服务器要拿到具体的项目对象，不能只记一个开关。
  const [bindingProject, setBindingProject] = useState<Workspace | undefined>(undefined);
  const dock = useConversationSidebar();
  const conversationVisible = !activePlugin && !archiveOpen;
  const sidebarVisible = dock.open && conversationVisible;
  const projects = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: ({ signal }) => api.listWorkspaces(signal),
  });
  const projectId = useChat((s) => s.workspaceId);
  useProjectNavigation(projects.data);
  const current = projects.data?.find((project) => project.id === projectId);
  const {
    sessionsByProject,
    loading: sessionsLoading,
    errorsByProject,
    retryProject,
  } = useProjectSessions(projects.data);
  const [showOtherSessions, setShowOtherSessions] = useState(false);
  const others = useOtherSessions(showOtherSessions);
  const openSession = (targetProject: string, session: SessionSummary) => {
    if (!allowConversationNavigation()) return;
    setArchiveOpen(false);
    plugins.show(undefined);
    if (useChat.getState().workspaceId !== targetProject) useChat.getState().selectWorkspace(targetProject);
    void useChat.getState().openSession(session);
  };
  const startSession = (targetProject: string, agent: AgentKind) => {
    if (!allowConversationNavigation()) return;
    setArchiveOpen(false);
    plugins.show(undefined);
    const chat = useChat.getState();
    if (chat.workspaceId !== targetProject) chat.selectWorkspace(targetProject);
    useChat.getState().newSession(agent);
  };

  return (
    <div className="flex h-full min-w-[800px] flex-col">
      <DesktopTitleBar />
      {serversOpen && <ServerManagerDialog onClose={() => setServersOpen(false)} />}
      <OpenPluginManager opened={plugins.managerOpen} close={() => plugins.setManagerOpen(false)} />
      <ProjectDialogs
        adding={addingProject}
        binding={bindingProject}
        managing={managingProject}
        closeAdd={() => setAddingProject(undefined)}
        closeBind={() => setBindingProject(undefined)}
        closeManage={() => setManagingProject(undefined)}
      />
      <OpenPalette
        opened={palette.opened}
        workspace={current}
        workspaces={projects.data}
        close={palette.close}
        actions={{
          plugins: plugins.commands.map((command) => ({
            ...command,
            run: () => {
              if (!command.run()) return false;
              setArchiveOpen(false);
              return true;
            },
          })),
          conversation: () => {
            if (!allowConversationNavigation()) return false;
            setArchiveOpen(false);
            plugins.show(undefined);
            return true;
          },
          settings: () => {
            setSettingsOpen(true);
            return true;
          },
        }}
      />
      <OpenSettings opened={settingsOpen} project={current} close={() => setSettingsOpen(false)} />
      <WorkspaceLayout
        dockOpen={sidebarVisible}
        dock={
          <ConversationSidebar
            workspace={current}
            open={sidebarVisible}
            close={dock.hide}
            settings={() => setSettingsOpen(true)}
          />
        }
        navigation={
          <Sidebar
            pages={
              <PluginNavigation
                plugins={plugins.list}
                selected={plugins.selected}
                open={showPlugin}
                manage={() => plugins.setManagerOpen(true)}
              />
            }
            projects={projects.data ?? []}
            sessionsByProject={sessionsByProject}
            sessionErrorsByProject={errorsByProject}
            onRetrySessions={retryProject}
            otherSessions={others.sessions}
            loadingOtherSessions={others.loading}
            otherSessionsError={others.error}
            onShowOtherSessions={setShowOtherSessions}
            loadingSessions={sessionsLoading}
            currentProjectId={current?.id}
            onAddProject={(initial) => setAddingProject(initial ?? {})}
            onManageProject={(project, action) => setManagingProject({ project, action })}
            onNewSession={startSession}
            onSelectProject={(id) => {
              if (!allowConversationNavigation()) return;
              setArchiveOpen(false);
              plugins.show(undefined);
              if (useChat.getState().workspaceId !== id) useChat.getState().selectWorkspace(id);
            }}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenCommands={palette.open}
            onOpenArchive={showArchive}
            onSelectSession={openSession}
            onBindServer={(project) => {
              if (allowConversationNavigation()) setBindingProject(project);
            }}
          />
        }
      >
        <div className="h-full min-h-0 min-w-0 w-full flex-1">
          <div
            hidden={!conversationVisible}
            inert={!conversationVisible}
            className={conversationVisible ? 'flex h-full min-h-0 flex-col' : 'hidden'}
          >
            <TopBar workspace={current} sidebarOpen={dock.open} onToggleSidebar={dock.toggle} />
            <EnvironmentSummary onOpenSettings={() => setSettingsOpen(true)} />
            <SessionPane
              project={current}
              pending={projects.isPending}
              error={projects.error}
              onAddProject={() => setAddingProject({})}
            />
          </div>
          <PluginWorkspace
            plugin={activePlugin}
            sshPlugin={plugins.ssh}
            project={current}
            close={() => plugins.show(undefined)}
            manageServers={() => setServersOpen(true)}
            bindServer={() => current && setBindingProject(current)}
            command={plugins.command}
          />
          {archiveOpen && (
            <Suspense
              fallback={
                <p role="status" className="p-4">
                  正在打开归档会话…
                </p>
              }
            >
              <ArchivedSessionsPage projects={projects.data ?? []} close={closeArchive} addProject={setAddingProject} />
            </Suspense>
          )}
        </div>
      </WorkspaceLayout>
    </div>
  );
}
