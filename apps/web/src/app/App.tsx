import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { workspaceTerminalTarget, terminalTargetKey, type Workspace } from '@ssh-server/shared';
import { ChatView } from '../features/chat/ChatView';
import { lastWorkspaceId, useChat } from '../features/chat/chat-store';
import { SyncPanel, type SyncActions } from '../features/sync/SyncPanel';
import { SshConnectionPanel } from '../features/ssh/SshConnectionPanel';
import { ResourcesPanel, type ResourcesActions } from '../features/resources/ResourcesPanel';
import { WorkspaceSidebar } from '../features/workspaces/WorkspaceSidebar';
import { VersionsPanel, type VersionsActions } from '../features/versions/VersionsPanel';
import { api, queryKeys } from '../lib/api';
import { TopBar } from './TopBar';
import { WorkspaceArea } from './WorkspaceArea';
import { useProductSettings } from '../features/settings/use-product-settings';
import { useUiPreferences } from '../ui/ui-preferences';
import { WorkspaceColumns, WorkspaceLayout } from './WorkspaceLayout';
import { useCommandPalette } from './use-command-palette';
import type { PaletteActions } from './CommandPalette';
import type { ChangesRequest } from '../features/changes/types';
import { ServerManagerDialog } from '../features/ssh/ServerManagerDialog';
import { EnvironmentSummary } from '../features/settings/EnvironmentReport';

const SettingsDialog = lazy(() => import('../features/settings/SettingsDialog'));
const FilesPanel = lazy(() => import('../features/files/FilesPanel'));
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

/** 对话保持主区，文件面板按需打开；窄窗口以覆盖层承载编辑。 */
export function App() {
  const resources = useRef<ResourcesActions>(null);
  const sync = useRef<SyncActions>(null);
  const versions = useRef<VersionsActions>(null);
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
  const [filesWorkspace, setFilesWorkspace] = useState<Workspace>();
  const [changesRequest, setChangesRequest] = useState<ChangesRequest>();
  const [terminalLoaded, setTerminalLoaded] = useState(false);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const hideTerminal = useCallback(() => setTerminalVisible(false), []);
  const workspaces = useQuery({ queryKey: queryKeys.workspaces, queryFn: ({ signal }) => api.listWorkspaces(signal) });
  const workspaceId = useChat((s) => s.workspaceId);
  const selectWorkspace = useChat((s) => s.selectWorkspace);
  const current = workspaces.data?.find((w) => w.id === workspaceId);
  const workspaceRemoved = useCallback((id: string) => {
    setFilesWorkspace((opened) => (opened?.id === id ? undefined : opened));
    setChangesRequest((opened) => (opened?.workspaceId === id ? undefined : opened));
  }, []);
  const openTerminal = () => {
    setTerminalLoaded(true);
    setTerminalVisible(true);
  };
  const openFiles = () => setFilesWorkspace((opened) => opened ?? current);
  const openChanges = (turnId: string) => {
    const conversation = useChat.getState();
    if (!current || conversation.workspaceId !== current.id) return;
    if (filesWorkspace && filesWorkspace.id !== current.id) {
      useChat.setState({ banner: '文件面板仍属于另一工作区，请先关闭该面板后查看此轮改动' });
      return;
    }
    setChangesRequest({
      workspaceId: current.id,
      agent: conversation.agent,
      conversationVersion: conversation.conversationVersion,
      turnId,
      nonce: crypto.randomUUID(),
    });
    setFilesWorkspace((opened) => opened ?? current);
  };

  // 首次加载后恢复上次的工作区，否则选第一个
  useEffect(() => {
    const list = workspaces.data;
    if (!list || current) return;
    const last = lastWorkspaceId();
    selectWorkspace(list.find((w) => w.id === last)?.id ?? list[0]?.id);
  }, [workspaces.data, current, selectWorkspace]);

  return (
    <div className="flex h-full min-w-[960px] flex-col">
      <TopBar
        workspace={current}
        onOpenCommands={palette.open}
        resources={
          current && (
            <ResourcesPanel
              key={terminalTargetKey(workspaceTerminalTarget(current))}
              workspace={current}
              ref={resources}
            />
          )
        }
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenServers={() => setServersOpen(true)}
        filesOpen={!!filesWorkspace}
        onOpenFiles={openFiles}
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
          files: () => {
            openFiles();
            return true;
          },
          terminal: () => {
            openTerminal();
            return true;
          },
          settings: () => {
            setSettingsOpen(true);
            return true;
          },
          sync: (id) => sync.current?.run(id) ?? false,
          versions: (id) => versions.current?.open(id) ?? false,
          resources: (id) => resources.current?.open(id) ?? false,
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
        navigation={<WorkspaceSidebar workspaces={workspaces} currentId={current?.id} onRemoved={workspaceRemoved} />}
      >
        <WorkspaceArea
          workspace={current}
          terminalLoaded={terminalLoaded}
          terminalVisible={terminalVisible}
          onHideTerminal={hideTerminal}
        >
          <WorkspaceColumns
            opened={!!filesWorkspace}
            files={
              filesWorkspace && (
                <Suspense
                  fallback={
                    <p role="status" className="p-4 text-sm">
                      正在打开文件…
                    </p>
                  }
                >
                  <FilesPanel
                    workspace={filesWorkspace}
                    changesRequest={changesRequest}
                    onClose={() => {
                      setFilesWorkspace(undefined);
                      setChangesRequest(undefined);
                    }}
                  />
                </Suspense>
              )
            }
          >
            <main className="flex min-w-0 flex-1 flex-col">
              {current ? (
                <>
                  <div
                    aria-label="工作区状态"
                    className="flex min-h-11 shrink-0 flex-wrap items-center gap-1 border-b border-border/60 px-4"
                  >
                    <SshConnectionPanel
                      key={JSON.stringify([current.id, current.sshHost, current.remoteDir])}
                      workspace={current}
                    />
                    <SyncPanel key={current.id} workspace={current} ref={sync} />
                    <VersionsPanel key={current.id} workspace={current} ref={versions} />
                  </div>
                  <ChatView workspace={current} onOpenChanges={openChanges} />
                </>
              ) : (
                <div className="m-auto max-w-sm text-center text-sm text-muted-foreground">
                  {workspaces.isPending ? '正在加载工作区…' : '在左侧新建或选择一个工作区后开始对话。'}
                </div>
              )}
            </main>
          </WorkspaceColumns>
        </WorkspaceArea>
      </WorkspaceLayout>
    </div>
  );
}
