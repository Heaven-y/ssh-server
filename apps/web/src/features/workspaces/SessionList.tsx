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
  const list = sessions.data?.toSorted((a, b) => b.lastModified - a.lastModified) ?? [];

  return (
    <section aria-labelledby="session-heading" className="flex min-h-0 flex-1 flex-col border-t border-border/70">
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 px-4 py-2">
        <h2 id="session-heading" className="text-xs font-semibold text-muted-foreground">
          会话
        </h2>
        <button type="button" className={`${buttonClass('ghost')} px-2`} onClick={newSession}>
          <Plus aria-hidden className="size-4" />
          新会话
        </button>
      </div>

      {sessions.isPending && <p className="px-5 py-3 text-sm text-muted-foreground">正在加载会话…</p>}
      {sessions.isError && (
        <p
          role="alert"
          className="mx-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm leading-6 text-destructive-foreground"
        >
          {sessions.error.message}
        </p>
      )}
      {sessions.isSuccess && list.length === 0 && (
        <p className="px-5 py-3 text-sm leading-6 text-muted-foreground">
          从一条消息开始。这里会保留当前工作区的会话。
        </p>
      )}

      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4 pt-1">
        {list.map((s) => {
          const current = s.sessionId === currentId;
          return (
            <li key={s.sessionId}>
              <button
                type="button"
                aria-current={current ? 'true' : undefined}
                title={s.summary || '无标题会话'}
                onClick={() => void openSession(s.sessionId)}
                className="group flex min-h-16 w-full items-start gap-2.5 rounded-lg border-l-2 border-transparent px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground aria-[current]:border-accent aria-[current]:bg-muted aria-[current]:text-foreground"
              >
                {current && running ? (
                  <LoaderCircle aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-accent" />
                ) : (
                  <MessageSquare aria-hidden className="mt-0.5 size-4 shrink-0 group-aria-[current]:text-accent" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 leading-5 group-aria-[current]:font-medium">
                    {s.summary || '无标题会话'}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <time dateTime={new Date(s.lastModified).toISOString()}>{timeFormat.format(s.lastModified)}</time>
                    {current && running && <span className="text-accent">运行中</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
