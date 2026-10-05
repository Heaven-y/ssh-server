import {
  FileCode2,
  FolderOpen,
  LoaderCircle,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings2,
  Sun,
  TerminalSquare,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { Workspace } from '@ssh-server/shared';
import { reconnectChat, useChat } from '../features/chat/chat-store';
import { buttonClass } from '../ui/styles';
import { useUiPreferences } from '../ui/ui-preferences';
import type { ReactNode } from 'react';

const STATUS = {
  open: { label: '本机服务已连接', icon: Wifi, cls: 'text-muted-foreground' },
  connecting: { label: '本机服务连接中', icon: LoaderCircle, cls: 'text-muted-foreground' },
  closed: { label: '本机服务已断开', icon: WifiOff, cls: 'text-destructive-foreground' },
} as const;

function AppearanceActions() {
  const collapsed = useUiPreferences((state) => state.sidebarCollapsed);
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
        aria-label={theme === 'dark' ? '切换亮色主题' : '切换暗色主题'}
        onClick={toggleTheme}
      >
        <ThemeIcon aria-hidden className="size-4" />
      </button>
    </>
  );
}

/** 顶栏：应用名、当前工作区、WebSocket 连接状态（图标 + 文字，不只靠颜色） */
export function TopBar({
  workspace,
  onOpenSettings,
  onOpenFiles,
  filesOpen,
  onOpenTerminal,
  terminalOpen,
  resources,
}: {
  workspace?: Workspace;
  onOpenSettings(): void;
  onOpenFiles(): void;
  filesOpen: boolean;
  onOpenTerminal(): void;
  terminalOpen: boolean;
  resources?: ReactNode;
}) {
  const connection = useChat((s) => s.connection);
  const st = STATUS[connection];
  const Icon = st.icon;

  return (
    <header className="flex shrink-0 flex-wrap items-center border-b border-border/70 bg-card">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <AppearanceActions />
        <TerminalSquare aria-hidden className="size-5 text-accent" />
        <span className="text-sm font-semibold tracking-wide">ssh-server</span>
      </div>
      {workspace && (
        <span
          className="flex min-w-0 flex-1 items-center gap-2 px-3 text-sm text-muted-foreground"
          title={workspace.localDir}
        >
          <FolderOpen aria-hidden className="size-4 shrink-0" />
          <span className="truncate text-foreground">{workspace.name}</span>
        </span>
      )}
      {resources && (
        <div className="order-last w-full border-t border-border/60 px-3 py-1 2xl:order-none 2xl:w-auto 2xl:flex-1 2xl:border-0">
          {resources}
        </div>
      )}
      <div className="ml-auto flex h-14 shrink-0 items-center gap-1 pr-4">
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
          aria-expanded={filesOpen}
          onClick={onOpenFiles}
        >
          <FileCode2 aria-hidden className="size-4" />
          文件
        </button>
        <button type="button" className={buttonClass('ghost')} onClick={onOpenSettings}>
          <Settings2 aria-hidden className="size-4" />
          设置
        </button>
        <span
          role="status"
          title="网页与本机后端的连接；SSH 状态在工作区状态栏中单独显示"
          className={`ml-3 flex items-center gap-1.5 whitespace-nowrap text-xs ${st.cls}`}
        >
          <Icon aria-hidden className={`size-4 ${connection === 'connecting' ? 'motion-safe:animate-pulse' : ''}`} />
          {st.label}
        </span>
        {connection !== 'open' && (
          <button
            type="button"
            className={buttonClass('ghost')}
            aria-label="重新连接网页 WebSocket"
            onClick={reconnectChat}
          >
            <RefreshCw aria-hidden className="size-4" />
            重连网页
          </button>
        )}
      </div>
    </header>
  );
}
