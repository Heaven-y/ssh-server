import { useQuery } from '@tanstack/react-query';
import { LoaderCircle, MessageSquare, Plus } from 'lucide-react';
import { api, queryKeys } from '../../lib/api';
import { buttonClass } from '../../ui/styles';
import { useChat } from '../chat/chat-store';

const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** 当前工作区的 Claude 会话（直接读取 Claude Code 本地保存的会话） */
export function SessionList({ workspaceId }: { workspaceId: string }) {
  const sessions = useQuery({
    queryKey: queryKeys.sessions(workspaceId),
    queryFn: () => api.listSessions(workspaceId),
  });
  const currentId = useChat((s) => s.sessionId);
  const running = useChat((s) => s.running);
  const openSession = useChat((s) => s.openSession);
  const newSession = useChat((s) => s.newSession);
  const list = [...(sessions.data ?? [])].sort((a, b) => b.lastModified - a.lastModified);

  return (
    <section aria-labelledby="session-heading" className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h2 id="session-heading" className="text-xs font-semibold text-muted-foreground">
          会话
        </h2>
        <button type="button" className={buttonClass('ghost')} onClick={newSession}>
          <Plus aria-hidden className="size-4" />
          新会话
        </button>
      </div>

      {sessions.isPending && <p className="text-sm text-muted-foreground">正在加载会话…</p>}
      {sessions.isError && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {sessions.error.message}
        </p>
      )}
      {sessions.isSuccess && list.length === 0 && <p className="text-sm text-muted-foreground">还没有会话。</p>}

      <ul className="flex flex-col gap-0.5">
        {list.map((s) => {
          const current = s.sessionId === currentId;
          return (
            <li key={s.sessionId}>
              <button
                type="button"
                aria-current={current ? 'true' : undefined}
                onClick={() => void openSession(s.sessionId)}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted aria-[current]:bg-muted"
              >
                {current && running ? (
                  <LoaderCircle aria-label="运行中" className="mt-0.5 size-4 shrink-0 animate-spin text-accent" />
                ) : (
                  <MessageSquare aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2">{s.summary || '（无标题）'}</span>
                  <span className="text-xs text-muted-foreground">{timeFormat.format(s.lastModified)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
