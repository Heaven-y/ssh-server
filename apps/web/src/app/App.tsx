import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import type { Workspace } from '@ssh-server/shared';
import { ChatView } from '../features/chat/ChatView';
import { useChat } from '../features/chat/chat-store';
import { useWorkspaceNavigation } from './use-workspace-navigation';
import { api, queryKeys } from '../lib/api';
import { TopBar } from './TopBar';
import { WorkspaceArea } from './WorkspaceArea';
import { useProductSettings } from '../features/settings/use-product-settings';
import { useUiPreferences } from '../ui/ui-preferences';
import { useCommandPalette } from './use-command-palette';
import type { PaletteActions } from './CommandPalette';
import { ServerManagerDialog } from '../features/ssh/ServerManagerDialog';
import { EnvironmentSummary } from '../features/settings/EnvironmentReport';
import { WorkspacePanels } from './WorkspacePanels';

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

/** 对话与资源停靠分屏；同步、版本与本地文件面板随三个域一起删除。 */
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
  const [resourcesOpen, setResourcesOpen] = useState(() => window.matchMedia('(min-width: 1280px)').matches);
  const [terminalLoaded, setTerminalLoaded] = useState(false);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const workspaces = useQuery({ queryKey: queryKeys.workspaces, queryFn: ({ signal }) => api.listWorkspaces(signal) });
  const workspaceId = useChat((s) => s.workspaceId);
  useWorkspaceNavigation(workspaces.data);
  const current = workspaces.data?.find((w) => w.id === workspaceId);
  const resourcesVisible = resourcesOpen && !!current;
  const openTerminal = () => {
    setTerminalLoaded(true);
    setTerminalVisible(true);
  };

  return (
    <div className="flex h-full min-w-[960px] flex-col">
      <TopBar
        workspace={current}
        onOpenCommands={palette.open}
        resourcesOpen={resourcesVisible}
        onOpenResources={() => setResourcesOpen((opened) => !opened)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenServers={() => setServersOpen(true)}
        terminalOpen={terminalVisible}
        onOpenTerminal={openTerminal}
      />
      <EnvironmentSummary onOpenSettings={() => setSettingsOpen(true)} />
      {serversOpen && <ServerManagerDialog onClose={() => setServersOpen(false)} />}
      <OpenPalette
        opened={palette.opened}
        workspace={current}
        workspaces={workspaces.data}
        close={palette.close}
        actions={{
          terminal: () => {
            openTerminal();
            return true;
          },
          settings: () => {
            setSettingsOpen(true);
            return true;
          },
          resources: (id) => {
            if (id !== current?.id) return false;
            setResourcesOpen(true);
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
      <WorkspacePanels
        navigation={
          <nav aria-label="项目列表" className="h-full overflow-auto p-3 text-sm text-muted-foreground">
            项目列表将在后续任务接入
          </nav>
        }
        resourcesOpen={resourcesVisible}
        workspace={current}
        hideResources={() => setResourcesOpen(false)}
      >
        <WorkspaceArea
          workspace={current}
          terminalLoaded={terminalLoaded}
          terminalVisible={terminalVisible}
          onHideTerminal={() => setTerminalVisible(false)}
        >
          <main className="flex min-w-0 flex-1 flex-col">
            {current ? (
              <ChatView workspace={current} />
            ) : (
              <div className="m-auto max-w-sm text-center text-sm text-muted-foreground">
                {workspaces.isPending ? '正在加载工作区…' : '在左侧新建或选择一个工作区后开始对话。'}
              </div>
            )}
          </main>
        </WorkspaceArea>
      </WorkspacePanels>
    </div>
  );
}
