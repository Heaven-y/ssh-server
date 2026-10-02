import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ChatView } from '../features/chat/ChatView';
import { lastWorkspaceId, useChat } from '../features/chat/chat-store';
import { SyncPanel } from '../features/sync/SyncPanel';
import { SshConnectionPanel } from '../features/workspaces/SshConnectionPanel';
import { WorkspaceSidebar } from '../features/workspaces/WorkspaceSidebar';
import { api, queryKeys } from '../lib/api';
import { TopBar } from './TopBar';

/** 两栏布局：工作区与会话在左侧，连接状态面板与对话区在右侧。 */
export function App() {
  const workspaces = useQuery({ queryKey: queryKeys.workspaces, queryFn: api.listWorkspaces });
  const workspaceId = useChat((s) => s.workspaceId);
  const selectWorkspace = useChat((s) => s.selectWorkspace);
  const current = workspaces.data?.find((w) => w.id === workspaceId);

  // 首次加载后恢复上次的工作区，否则选第一个
  useEffect(() => {
    const list = workspaces.data;
    if (!list?.length || current) return;
    const last = lastWorkspaceId();
    selectWorkspace(list.find((w) => w.id === last)?.id ?? list[0]!.id);
  }, [workspaces.data, current, selectWorkspace]);

  return (
    <div className="flex h-full min-w-[960px] flex-col">
      <TopBar workspace={current} />
      <div className="flex min-h-0 flex-1">
        <WorkspaceSidebar workspaces={workspaces} currentId={current?.id} />
        <main className="flex min-w-0 flex-1 flex-col">
          {current ? (
            <>
              <SshConnectionPanel
                key={JSON.stringify([current.id, current.sshHost, current.authMode ?? 'key', current.remoteDir])}
                workspace={current}
              />
              <SyncPanel key={current.id} workspace={current} />
              <ChatView workspace={current} />
            </>
          ) : (
            <div className="m-auto max-w-sm text-center text-sm text-muted-foreground">
              {workspaces.isPending ? '正在加载工作区…' : '在左侧新建或选择一个工作区后开始对话。'}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
