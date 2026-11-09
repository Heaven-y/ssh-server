import { LoaderCircle, PanelRightClose, PanelRightOpen, RefreshCw, WifiOff } from 'lucide-react';
import type { Workspace } from '@agentdeck/shared/projects';
import { reconnectChat, useChat } from '../features/chat/chat-store';
import { conversationTitle } from '../features/chat/conversations';
import { ConversationViewControls } from '../features/chat/ConversationViewControls';

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
  const running = useChat((state) => state.running);
  const title = useChat((state) => state.title || conversationTitle(state));
  const SidebarIcon = sidebarOpen ? PanelRightClose : PanelRightOpen;
  return (
    <header id="workspace-topbar" className="flex h-12 shrink-0 items-center gap-3 px-5">
      <div className="min-w-12 flex-1">
        <h1 className="truncate text-sm font-medium" title={title}>
          {title}
        </h1>
        {workspace && (
          <p className="truncate text-xs text-muted-foreground" title={workspace.dir}>
            {workspace.name}
          </p>
        )}
      </div>
      {workspace && <ConversationViewControls />}
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
