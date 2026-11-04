import { CircleAlert, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { Workspace } from '@agentdeck/shared';
import { sessionListQuery } from '../sessions/use-sessions';
import { agentVersion, useEnvironment } from '../settings/use-environment';
import { buttonClass } from '../../ui/styles';
import { useChat } from './chat-store';
import { Composer } from './Composer';
import { ChatTimeline } from './ChatTimeline';
import { AGENT_LABELS } from './AgentControls';
import { AgentIcon } from '../../ui/BrandIcons';

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

function HistoryFailure() {
  const historyError = useChat((s) => s.historyError);
  const sessionId = useChat((s) => s.sessionId);
  const agent = useChat((s) => s.agent);
  const openSession = useChat((s) => s.openSession);
  const newSession = useChat((s) => s.newSession);

  if (!historyError) return null;
  return (
    <div className="mx-4 space-y-2 rounded-md border border-border p-3 sm:mx-6">
      <p role="alert" className="text-sm text-destructive-foreground">
        {historyError}
      </p>
      <button
        type="button"
        className={buttonClass('outline')}
        onClick={() =>
          sessionId ? void openSession({ agent, sessionId }, { preserveDraft: true }) : newSession(agent)
        }
      >
        {sessionId ? '重新读取历史' : '开始新会话'}
      </button>
    </div>
  );
}

function Messages() {
  const items = useChat((s) => s.items);
  const running = useChat((s) => s.running);
  const loading = useChat((s) => s.loadingHistory);
  const version = useChat((s) => s.conversationVersion);
  const historyError = useChat((s) => s.historyError);
  const historyNotice = useChat((s) => s.historyNotice);
  const sessionId = useChat((s) => s.sessionId);
  if (loading) return <p className="m-auto text-sm text-muted-foreground">正在加载会话…</p>;
  if (historyError && items.length === 0) return null;
  if (items.length === 0)
    return (
      <div className="m-auto max-w-md px-6 py-12 text-center">
        <h2 className="text-xl font-medium tracking-tight">{sessionId ? '继续原生会话' : '从一条消息开始'}</h2>
        <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
          {historyNotice ?? (sessionId ? '原生记录中没有可显示的消息，可以继续发送。' : '描述你想完成的任务。')}
        </p>
      </div>
    );

  return <ChatTimeline key={version} items={items} running={running} />;
}

export function ChatView({ workspace }: { workspace: Workspace }) {
  const sessionId = useChat((s) => s.sessionId);
  const agent = useChat((s) => s.agent);
  const version = useChat((s) => s.conversationVersion);
  const running = useChat((s) => s.running);
  const environment = useEnvironment();
  const cliVersion = agentVersion(environment.data, agent);
  // 与侧栏共享查询结果，使用已有会话标题，避免把不易辨认的 ID 当作标题。
  const sessions = useQuery(sessionListQuery(workspace.id, agent));
  const title = sessions.data?.find((session) => session.sessionId === sessionId)?.title;
  return (
    <>
      <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium" title={sessionId}>
            {sessionId ? title || '历史会话' : '新会话'}
          </h1>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <AgentIcon agent={agent} className="size-3.5" />
            <span className="truncate">
              {AGENT_LABELS[agent]}
              {cliVersion ? ` ${cliVersion}` : ''} · {workspace.name}
              {running ? ' · 运行中' : ''}
            </span>
          </p>
        </div>
      </div>
      <Banner />
      <HistoryFailure />
      {agent === 'antigravity' && (
        <p className="mx-4 mb-2 rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground sm:mx-6">
          权限由 Antigravity
          原生配置决定；需要确认的工具在无界面模式下可能被拒绝。历史轨迹暂不能回放，本次收到的内容仅保留在当前页面。
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <Messages />
      </div>
      <Composer key={version} />
    </>
  );
}
