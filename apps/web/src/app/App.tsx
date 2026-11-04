import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import type { AgentKind, SessionSummary, Workspace } from '@agentdeck/shared';
import { useChat } from '../features/chat/chat-store';
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

const SettingsDialog = lazy(() => import('../features/settings/SettingsDialog'));
const CommandPalette = lazy(() => import('./CommandPalette'));

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
  const [serversOpen, setServersOpen] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
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
    if (useChat.getState().workspaceId !== targetProject) useChat.getState().selectWorkspace(targetProject);
    void useChat.getState().openSession(session);
  };
  const startSession = (targetProject: string, agent: AgentKind) => {
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
        terminalOpen={dock.open && dock.view === 'terminal'}
        onOpenTerminal={() => dock.reveal('terminal')}
      />
      <EnvironmentSummary onOpenSettings={() => setSettingsOpen(true)} />
      {serversOpen && <ServerManagerDialog onClose={() => setServersOpen(false)} />}
      {addProjectOpen && <AddProjectDialog onClose={() => setAddProjectOpen(false)} />}
      <OpenPalette
        opened={palette.opened}
        workspace={current}
        workspaces={projects.data}
        close={palette.close}
        actions={{
          terminal: () => {
            dock.reveal('terminal');
            return true;
          },
          settings: () => {
            setSettingsOpen(true);
            return true;
          },
          resources: (id) => {
            if (id !== current?.id) return false;
            dock.reveal('resources');
            return true;
          },
        }}
      />
      {settingsOpen && (
        <Suspense
          fallback={
            <p
              role="status"
              className="absolute right-4 top-14 z-50 rounded-md border border-border bg-card p-3 text-sm"
            >
              正在打开设置…
            </p>
          }
        >
          <SettingsDialog onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
      <WorkspaceLayout
        dockOpen={dock.open}
        dock={
          <ServerDock
            workspace={current}
            open={dock.open}
            view={dock.view}
            loaded={dock.loaded}
            onSelectView={dock.select}
            onHide={dock.hide}
          />
        }
        navigation={
          <Sidebar
            projects={projects.data ?? []}
            sessionsByProject={sessionsByProject}
            loadingSessions={sessionsLoading}
            currentProjectId={current?.id}
            onAddProject={() => setAddProjectOpen(true)}
            onNewSession={startSession}
            onSelectProject={(id) => useChat.getState().selectWorkspace(id)}
            onSelectSession={openSession}
          />
        }
      >
        <SessionPane
          project={current}
          pending={projects.isPending}
          error={projects.error}
          onAddProject={() => setAddProjectOpen(true)}
        />
      </WorkspaceLayout>
    </div>
  );
}
