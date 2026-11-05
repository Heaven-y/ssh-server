import { CircleAlert, X } from 'lucide-react';
import type { Workspace } from '@agentdeck/shared';
import { buttonClass } from '../../ui/styles';
import { useChat } from './chat-store';
import { Composer } from './Composer';
import { ChatTimeline } from './ChatTimeline';

function Banner() {
  const banner = useChat((s) => s.banner);
  const dismiss = useChat((s) => s.dismissBanner);
  if (!banner) return null;
  return (
    <div
      role="alert"
      className="conversation-notice flex items-start gap-2 rounded-xl bg-destructive/8 px-3 py-2 text-[13px]"
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
    <div className="conversation-notice space-y-2 rounded-xl border border-border p-3">
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
      <div className="m-auto max-w-lg px-6 py-12 text-center">
        <h2 className="text-[26px] font-medium leading-8 tracking-tight">
          {sessionId ? '继续原生会话' : '从一条消息开始'}
        </h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {historyNotice ?? (sessionId ? '原生记录中没有可显示的消息，可以继续发送。' : '描述你想完成的任务。')}
        </p>
      </div>
    );

  return <ChatTimeline key={version} items={items} running={running} />;
}

export function ChatView({ workspace }: { workspace: Workspace }) {
  const agent = useChat((s) => s.agent);
  const version = useChat((s) => s.conversationVersion);
  return (
    <section className="conversation" aria-label={`${workspace.name}会话`}>
      <Banner />
      <HistoryFailure />
      {agent === 'antigravity' && (
        <details className="conversation-notice text-xs leading-5 text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded-lg py-1 hover:text-foreground">原生会话说明</summary>
          <p className="mt-1 leading-6">
            权限由 Antigravity
            原生配置决定；需要确认的工具在无界面模式下可能被拒绝。历史轨迹暂不能回放，本次收到的内容仅保留在当前页面。
          </p>
        </details>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <Messages />
      </div>
      <Composer key={version} />
    </section>
  );
}
