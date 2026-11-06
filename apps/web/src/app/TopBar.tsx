import { useQuery } from '@tanstack/react-query';
import { LoaderCircle, PanelRightClose, PanelRightOpen, RefreshCw, WifiOff } from 'lucide-react';
import type { Workspace } from '@agentdeck/shared/projects';
import { reconnectChat, useChat } from '../features/chat/chat-store';
import { sessionListQuery } from '../features/sessions/use-sessions';

/** 会话标题栏位于中央列，不让服务器和全局工具占据对话导航。 */
export function TopBar({
  workspace,
  sidebarOpen,
  onToggleSidebar,
}: {
  workspace?: Workspace;
  sidebarOpen: boolean;
  onToggleSidebar(): void;
}) {
  const agent = useChat((state) => state.agent);
  const sessionId = useChat((state) => state.sessionId);
  const running = useChat((state) => state.running);
  const sessions = useQuery({ ...sessionListQuery(workspace?.id ?? '', agent), enabled: !!workspace });
  const title = conversationTitle(sessionId, sessions.data);
  const SidebarIcon = sidebarOpen ? PanelRightClose : PanelRightOpen;
  return (
    <header id="workspace-topbar" className="flex h-12 shrink-0 items-center gap-3 px-5">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-medium" title={title}>
          {title}
        </h1>
        {workspace && (
          <p className="truncate text-xs text-muted-foreground" title={workspace.dir}>
            {workspace.name}
          </p>
        )}
      </div>
      {running && (
        <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" />
          运行中
        </span>
      )}
      <ConnectionStatus />
      <button
        type="button"
        aria-label={sidebarOpen ? '关闭右侧边栏' : '打开右侧边栏'}
        title={sidebarOpen ? '关闭右侧边栏' : '打开右侧边栏'}
        aria-expanded={sidebarOpen}
        aria-controls="conversation-sidebar"
        onClick={onToggleSidebar}
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <SidebarIcon aria-hidden className="size-4" />
      </button>
    </header>
  );
}

function ConnectionStatus() {
  const connection = useChat((state) => state.connection);
  if (connection === 'open') return null;
  const Icon = connection === 'closed' ? WifiOff : RefreshCw;
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
      onClick={reconnectChat}
      title="重新连接本机服务"
    >
      <Icon aria-hidden className="size-3.5" />
      {connection === 'closed' ? '连接已断开' : '连接中'}
    </button>
  );
}

function conversationTitle(
  sessionId: string | null | undefined,
  sessions?: Array<{ sessionId: string; title: string }>,
) {
  if (!sessionId) return '新会话';
  return sessions?.find((item) => item.sessionId === sessionId)?.title || '历史会话';
}
