import { LoaderCircle, RefreshCw, Server, Settings2, Wifi, WifiOff } from 'lucide-react';
import type { Workspace } from '@ssh-server/shared';
import { reconnectChat, useChat } from '../features/chat/chat-store';
import { buttonClass } from '../ui/styles';

const STATUS = {
  open: { label: '网页已连接', icon: Wifi, cls: 'text-accent' },
  connecting: { label: '网页连接中', icon: LoaderCircle, cls: 'text-muted-foreground' },
  closed: { label: '网页已断开', icon: WifiOff, cls: 'text-destructive-foreground' },
} as const;

/** 顶栏：应用名、当前工作区、WebSocket 连接状态（图标 + 文字，不只靠颜色） */
export function TopBar({ workspace, onOpenSettings }: { workspace?: Workspace; onOpenSettings(): void }) {
  const connection = useChat((s) => s.connection);
  const st = STATUS[connection];
  const Icon = st.icon;

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-card px-4">
      <span className="font-semibold">ssh-server</span>
      {workspace && (
        <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <Server aria-hidden className="size-4 shrink-0" />
          <span className="truncate">
            <span className="text-foreground">{workspace.name}</span>
            <span className="font-mono">
              {' '}
              · {workspace.sshHost}:{workspace.remoteDir}
            </span>
          </span>
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button type="button" className={buttonClass('ghost')} onClick={onOpenSettings}>
          <Settings2 aria-hidden className="size-4" />
          设置
        </button>
        <span
          role="status"
          title="网页 WebSocket 连接状态；SSH 认证请查看工作区的 SSH 连接面板"
          className={`flex items-center gap-1.5 whitespace-nowrap text-sm ${st.cls}`}
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
