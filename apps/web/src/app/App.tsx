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
import { ServerDock } from './ServerDock';
import { WorkspaceLayout } from './WorkspaceLayout';
import { useProjectNavigation } from './use-project-navigation';
import { useProjectSessions } from './use-project-sessions';
import { useServerDock } from './use-server-dock';
import { AddProjectDialog } from './AddProjectDialog';
import { BindServerDialog } from './BindServerDialog';
import { ProjectManageDialog } from './ProjectManageDialog';
import type { ProjectDraft, ProjectManageAction } from './project-management';
import { PluginNavigation } from '../features/plugins/PluginNavigation';
import { PluginWorkspace } from '../features/plugins/PluginWorkspace';
import { usePluginPages } from '../features/plugins/use-plugin-pages';

const SettingsDialog = lazy(() => import('../features/settings/SettingsDialog'));
const CommandPalette = lazy(() => import('./CommandPalette'));
const PluginManager = lazy(() => import('../features/plugins/PluginManager'));

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

/** 三段式外壳：顶栏 / 左栏项目与会话 / 主区会话 / 右侧服务器面板。 */
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
  const [serversOpen, setServersOpen] = useState(false);
  const [addingProject, setAddingProject] = useState<ProjectDraft>();
  const [managingProject, setManagingProject] = useState<{ project: Workspace; action: ProjectManageAction }>();
  // 绑定服务器要拿到具体的项目对象，不能只记一个开关。
  const [bindingProject, setBindingProject] = useState<Workspace | undefined>(undefined);
  const dock = useServerDock();
  const projects = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: ({ signal }) => api.listWorkspaces(signal),
  });
  const projectId = useChat((s) => s.workspaceId);
  useProjectNavigation(projects.data);
  const current = projects.data?.find((project) => project.id === projectId);
  const { sessionsByProject, loading: sessionsLoading } = useProjectSessions(projects.data);
  const openSession = (targetProject: string, session: SessionSummary) => {
    if (!allowConversationNavigation()) return;
    plugins.show(undefined);
    if (useChat.getState().workspaceId !== targetProject) useChat.getState().selectWorkspace(targetProject);
    void useChat.getState().openSession(session);
  };
  const startSession = (targetProject: string, agent: AgentKind) => {
    if (!allowConversationNavigation()) return;
    plugins.show(undefined);
    const chat = useChat.getState();
    if (chat.workspaceId !== targetProject) chat.selectWorkspace(targetProject);
    useChat.getState().newSession(agent);
  };

  return (
    <div className="flex h-full min-w-[960px] flex-col">
      <TopBar
        workspace={current}
        onOpenCommands={palette.open}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenServers={() => setServersOpen(true)}
        onOpenPlugins={() => plugins.setManagerOpen(true)}
        terminalOpen={dock.open && dock.view === 'terminal'}
        onOpenTerminal={() => {
          plugins.show(undefined);
          dock.reveal('terminal');
        }}
      />
      <EnvironmentSummary onOpenSettings={() => setSettingsOpen(true)} />
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
          plugins: plugins.commands,
          conversation: () => {
            if (!allowConversationNavigation()) return false;
            plugins.show(undefined);
            return true;
          },
          terminal: () => {
            plugins.show(undefined);
            dock.reveal('terminal');
            return true;
          },
          settings: () => {
            setSettingsOpen(true);
            return true;
          },
          resources: (id) => {
            if (id !== current?.id) return false;
            plugins.show(undefined);
            dock.reveal('resources');
            return true;
          },
        }}
      />
      <OpenSettings opened={settingsOpen} project={current} close={() => setSettingsOpen(false)} />
      <WorkspaceLayout
        dockOpen={dock.open && !activePlugin}
        dock={
          <ServerDock
            workspace={current}
            open={dock.open && !activePlugin}
            view={dock.view}
            loaded={dock.loaded}
            onSelectView={dock.select}
            onHide={dock.hide}
          />
        }
        navigation={
          <Sidebar
            pages={
              <PluginNavigation
                plugins={plugins.list}
                selected={plugins.selected}
                open={plugins.show}
                manage={() => plugins.setManagerOpen(true)}
              />
            }
            projects={projects.data ?? []}
            sessionsByProject={sessionsByProject}
            loadingSessions={sessionsLoading}
            currentProjectId={current?.id}
            onAddProject={(initial) => setAddingProject(initial ?? {})}
            onManageProject={(project, action) => setManagingProject({ project, action })}
            onNewSession={startSession}
            onSelectProject={(id) => useChat.getState().selectWorkspace(id)}
            onSelectSession={openSession}
            onBindServer={(project) => {
              if (allowConversationNavigation()) setBindingProject(project);
            }}
          />
        }
      >
        <div className="h-full min-h-0 min-w-0 w-full flex-1">
          <div
            hidden={!!activePlugin}
            inert={!!activePlugin}
            className={activePlugin ? 'hidden' : 'flex h-full min-h-0 flex-col'}
          >
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
            command={plugins.command}
          />
        </div>
      </WorkspaceLayout>
    </div>
  );
}
