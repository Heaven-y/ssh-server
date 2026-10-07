import { CircleAlert, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { Workspace } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { useChat } from './chat-store';
import { Composer } from './Composer';
import { ChatTimeline } from './ChatTimeline';
import { AGENT_LABELS } from './AgentControls';
import { TurnChangesCard } from '../changes/TurnChangesCard';

function Banner() {
  const banner = useChat((s) => s.banner);
  const dismiss = useChat((s) => s.dismissBanner);
  if (!banner) return null;
  return (
    <div
      role="alert"
      className="mx-4 mt-3 flex items-start gap-3 rounded-lg bg-destructive/10 px-4 py-3 text-sm sm:mx-6"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1 leading-6 break-words text-destructive-foreground">{banner}</span>
      <button
        type="button"
        aria-label="关闭提示"
        className="-m-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={dismiss}
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

function Messages() {
  const items = useChat((s) => s.items);
  const running = useChat((s) => s.running);
  const loading = useChat((s) => s.loadingHistory);
  const version = useChat((s) => s.conversationVersion);

  if (loading) return <p className="m-auto text-sm text-muted-foreground">正在加载会话…</p>;
  if (items.length === 0)
    return (
      <div className="m-auto max-w-md px-6 py-12 text-center">
        <h2 className="text-xl font-medium tracking-tight">从一条消息开始</h2>
        <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
          描述你想完成的任务。Agent 会结合当前项目，在服务器目录中执行命令。
        </p>
      </div>
    );

  return <ChatTimeline key={version} items={items} running={running} />;
}

export function ChatView({ workspace, onOpenChanges }: { workspace: Workspace; onOpenChanges?(turnId: string): void }) {
  const sessionId = useChat((s) => s.sessionId);
  const agent = useChat((s) => s.agent);
  const actualModel = useChat((s) => s.actualModel);
  // 与侧栏共享查询结果，使用已有会话标题，避免把不易辨认的 ID 当作标题。
  const sessions = useQuery({
    queryKey: queryKeys.sessions(workspace.id, agent),
    queryFn: () => api.listSessions(workspace.id, agent),
  });
  const title = sessions.data?.find((session) => session.sessionId === sessionId)?.summary;
  return (
    <>
      <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium" title={sessionId}>
            {sessionId ? title || '历史会话' : '新会话'}
          </h1>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {AGENT_LABELS[agent]} · {workspace.name}
          </p>
        </div>
        <span className="max-w-[50%] truncate text-xs text-muted-foreground" title={actualModel}>
          实际模型：{actualModel || '未报告'}
        </span>
      </div>
      <Banner />
      <div className="flex min-h-0 flex-1 flex-col">
        <Messages />
      </div>
      {onOpenChanges && <TurnChangesCard workspaceId={workspace.id} open={onOpenChanges} />}
      <Composer />
    </>
  );
}
