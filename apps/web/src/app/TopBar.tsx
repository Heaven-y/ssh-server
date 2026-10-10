import {
  Activity,
  FileCode2,
  Command as CommandIcon,
  FolderOpen,
  LoaderCircle,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings2,
  Server,
  Sun,
  TerminalSquare,
  WifiOff,
} from 'lucide-react';
import type { Workspace } from '@ssh-server/shared';
import { reconnectChat, useChat } from '../features/chat/chat-store';
import { buttonClass } from '../ui/styles';
import { useUiPreferences } from '../ui/ui-preferences';
import { SshConnectionPanel } from '../features/ssh/SshConnectionPanel';

const STATUS = {
  connecting: { label: '本机服务连接中', icon: LoaderCircle, cls: 'text-muted-foreground' },
  closed: { label: '本机服务已断开', icon: WifiOff, cls: 'text-destructive-foreground' },
} as const;

export function AppearanceActions() {
  const collapsed = useUiPreferences((state) => state.sidebarCollapsed || state.sidebarAutoCollapsed);
  const theme = useUiPreferences((state) => state.theme);
  const setCollapsed = useUiPreferences((state) => state.setSidebarCollapsed);
  const toggleTheme = useUiPreferences((state) => state.toggleTheme);
  const SidebarIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const ThemeIcon = theme === 'dark' ? Sun : Moon;
  return (
    <>
      <button
        type="button"
        className={buttonClass('ghost')}
        aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
      >
        <SidebarIcon aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        className={buttonClass('ghost')}
        aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
        onClick={toggleTheme}
      >
        <ThemeIcon aria-hidden className="size-4" />
        {theme === 'dark' ? '浅色' : '深色'}
      </button>
    </>
  );
}

function BackendConnectionStatus() {
  const connection = useChat((state) => state.connection);
  if (connection === 'open') return null;
  const status = STATUS[connection];
  const Icon = status.icon;
  return (
    <>
      <span
        role="status"
        title="网页与本机后端的连接"
        className={`ml-2 flex items-center gap-1.5 whitespace-nowrap text-xs ${status.cls}`}
      >
        <Icon aria-hidden className={`size-4 ${connection === 'connecting' ? 'motion-safe:animate-pulse' : ''}`} />
        {status.label}
      </span>
      <button
        type="button"
        className={buttonClass('ghost')}
        aria-label="重新连接网页 WebSocket"
        onClick={reconnectChat}
      >
        <RefreshCw aria-hidden className="size-4" />
        重连网页
      </button>
    </>
  );
}

/** 顶栏突出当前工作区SSH，本机WebSocket只有异常状态才提示。 */
export function TopBar({
  workspace,
  onOpenSettings,
  onOpenServers,
  onOpenFiles,
  filesOpen,
  onOpenTerminal,
  terminalOpen,
  resourcesOpen,
  onOpenResources,
  onOpenCommands,
}: {
  workspace?: Workspace;
  onOpenSettings(): void;
  onOpenServers(): void;
  onOpenFiles(): void;
  filesOpen: boolean;
  onOpenTerminal(): void;
  terminalOpen: boolean;
  resourcesOpen: boolean;
  onOpenResources(): void;
  onOpenCommands(): void;
}) {
  return (
    <header id="workspace-topbar" className="flex shrink-0 flex-wrap items-center border-b border-border/70 bg-card">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <AppearanceActions />
        <TerminalSquare aria-hidden className="size-5 text-accent" />
        <span className="text-sm font-semibold tracking-wide">ssh-server</span>
      </div>
      {workspace && (
        <div className="flex min-w-0 flex-[1_1_24rem] items-center gap-2 px-3 text-sm text-muted-foreground">
          <FolderOpen aria-hidden className="size-4 shrink-0" />
          <span className="truncate text-foreground" title={workspace.localDir}>
            {workspace.name}
          </span>
          <SshConnectionPanel
            key={JSON.stringify([workspace.id, workspace.sshHost, workspace.remoteDir])}
            workspace={workspace}
          />
        </div>
      )}
      <div className="ml-auto flex h-14 shrink-0 items-center gap-1 pr-4">
        <button
          type="button"
          className={buttonClass('ghost')}
          aria-label="搜索与操作"
          title="搜索与操作 · Ctrl+K / Cmd+K"
          aria-haspopup="dialog"
          onClick={onOpenCommands}
        >
          <CommandIcon aria-hidden className="size-4" />
          搜索与操作
        </button>
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={!workspace && !terminalOpen}
          aria-expanded={terminalOpen}
          onClick={onOpenTerminal}
        >
          <TerminalSquare aria-hidden className="size-4" />
          终端
        </button>
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={!workspace}
          aria-expanded={resourcesOpen}
          aria-controls="workspace-resources-panel"
          onClick={onOpenResources}
        >
          <Activity aria-hidden className="size-4" />
          资源
        </button>
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={!workspace}
          aria-expanded={filesOpen}
          aria-controls="workspace-files-panel"
          onClick={onOpenFiles}
        >
          <FileCode2 aria-hidden className="size-4" />
          文件
        </button>
        <button type="button" className={buttonClass('ghost')} onClick={onOpenServers} aria-haspopup="dialog">
          <Server aria-hidden className="size-4" />
          服务器
        </button>
        <button type="button" className={buttonClass('ghost')} onClick={onOpenSettings}>
          <Settings2 aria-hidden className="size-4" />
          设置
        </button>
        <BackendConnectionStatus />
      </div>
    </header>
  );
}
