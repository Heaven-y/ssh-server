import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Workspace } from '@ssh-server/shared';
import { ChatView } from '../features/chat/ChatView';
import { lastWorkspaceId, useChat } from '../features/chat/chat-store';
import { SyncPanel } from '../features/sync/SyncPanel';
import { SshConnectionPanel } from '../features/ssh/SshConnectionPanel';
import { ResourcesPanel } from '../features/resources/ResourcesPanel';
import { WorkspaceSidebar } from '../features/workspaces/WorkspaceSidebar';
import { VersionsPanel } from '../features/versions/VersionsPanel';
import { api, queryKeys } from '../lib/api';
import { TopBar } from './TopBar';
import { WorkspaceArea } from './WorkspaceArea';

const SettingsDialog = lazy(() => import('../features/settings/SettingsDialog'));
const FilesPanel = lazy(() => import('../features/files/FilesPanel'));

/** 对话保持主区，文件面板按需打开；窄窗口以覆盖层承载编辑。 */
export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filesWorkspace, setFilesWorkspace] = useState<Workspace>();
  const [terminalLoaded, setTerminalLoaded] = useState(false);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const hideTerminal = useCallback(() => setTerminalVisible(false), []);
  const workspaces = useQuery({ queryKey: queryKeys.workspaces, queryFn: ({ signal }) => api.listWorkspaces(signal) });
  const workspaceId = useChat((s) => s.workspaceId);
  const selectWorkspace = useChat((s) => s.selectWorkspace);
  const current = workspaces.data?.find((w) => w.id === workspaceId);
  const workspaceRemoved = useCallback((id: string) => {
    setFilesWorkspace((opened) => (opened?.id === id ? undefined : opened));
  }, []);

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
        onOpenSettings={() => setSettingsOpen(true)}
        filesOpen={!!filesWorkspace}
        onOpenFiles={() => setFilesWorkspace((opened) => opened ?? current)}
        terminalOpen={terminalVisible}
        onOpenTerminal={() => {
          setTerminalLoaded(true);
          setTerminalVisible(true);
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
      <div className="flex min-h-0 flex-1">
        <WorkspaceSidebar workspaces={workspaces} currentId={current?.id} onRemoved={workspaceRemoved} />
        <WorkspaceArea
          workspace={current}
          terminalLoaded={terminalLoaded}
          terminalVisible={terminalVisible}
          onHideTerminal={hideTerminal}
        >
          <main className="flex min-w-0 flex-1 flex-col">
            {current ? (
              <>
                <div
                  aria-label="工作区状态"
                  className="flex min-h-11 shrink-0 flex-wrap items-center gap-1 border-b border-border/60 px-4"
                >
                  <SshConnectionPanel
                    key={JSON.stringify([current.id, current.sshHost, current.authMode ?? 'key', current.remoteDir])}
                    workspace={current}
                  />
                  <SyncPanel key={current.id} workspace={current} />
                  <VersionsPanel key={current.id} workspace={current} />
                  <ResourcesPanel key={current.id} workspace={current} />
                </div>
                <ChatView workspace={current} />
              </>
            ) : (
              <div className="m-auto max-w-sm text-center text-sm text-muted-foreground">
                {workspaces.isPending ? '正在加载工作区…' : '在左侧新建或选择一个工作区后开始对话。'}
              </div>
            )}
          </main>
          {filesWorkspace && (
            <Suspense
              fallback={
                <p role="status" className="p-4 text-sm">
                  正在打开文件…
                </p>
              }
            >
              <FilesPanel workspace={filesWorkspace} onClose={() => setFilesWorkspace(undefined)} />
            </Suspense>
          )}
        </WorkspaceArea>
      </div>
    </div>
  );
}
