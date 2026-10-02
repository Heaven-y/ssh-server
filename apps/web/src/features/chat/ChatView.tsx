import { ArrowDown, CircleAlert, X } from 'lucide-react';
import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import type { Workspace } from '@ssh-server/shared';
import { buttonClass, inputClass } from '../../ui/styles';
import { api, queryKeys } from '../../lib/api';
import { useChat } from './chat-store';
import { Composer } from './Composer';
import { MessageItem } from './MessageItem';

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

function ModelInput() {
  const id = useId();
  const model = useChat((s) => s.model);
  const actual = useChat((s) => s.actualModel);
  const setModel = useChat((s) => s.setModel);
  return (
    <div className="flex min-w-0 max-w-full flex-col items-end gap-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="shrink-0 whitespace-nowrap">
          模型
        </label>
        <input
          id={id}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="跟随本地配置"
          spellCheck={false}
          className={`${inputClass} w-44 py-1.5 font-mono text-xs`}
        />
      </div>
      {actual && (
        <span title={actual} className="max-w-64 truncate">
          实际模型：{actual}
        </span>
      )}
    </div>
  );
}

/** 用户上翻离开底部时显示"回到底部" */
function ScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <button
      type="button"
      className={`${buttonClass('outline')} absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap bg-card shadow-sm`}
      onClick={() => void scrollToBottom()}
    >
      <ArrowDown aria-hidden className="size-4" />
      回到底部
    </button>
  );
}

function Messages() {
  const items = useChat((s) => s.items);
  const running = useChat((s) => s.running);
  const loading = useChat((s) => s.loadingHistory);

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

  return (
    <StickToBottom className="relative min-h-0 flex-1" resize="smooth" initial="instant">
      {/* 流式输出期间 aria-busy，结束后读屏器再播报整段内容，避免逐字打断 */}
      <StickToBottom.Content
        className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8"
        aria-live="polite"
        aria-busy={running}
        aria-label="对话内容"
        role="log"
      >
        {items.map((item) => (
          <MessageItem key={item.id} item={item} />
        ))}
      </StickToBottom.Content>
      <ScrollToBottomButton />
    </StickToBottom>
  );
}

export function ChatView({ workspace }: { workspace: Workspace }) {
  const sessionId = useChat((s) => s.sessionId);
  // 与侧栏共享查询结果，使用已有会话标题，避免把不易辨认的 ID 当作标题。
  const sessions = useQuery({
    queryKey: queryKeys.sessions(workspace.id),
    queryFn: () => api.listSessions(workspace.id),
  });
  const title = sessions.data?.find((session) => session.sessionId === sessionId)?.summary;
  return (
    <>
      <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium" title={sessionId}>
            {sessionId ? title || '历史会话' : '新会话'}
          </h1>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">Claude · {workspace.name}</p>
        </div>
        <ModelInput />
      </div>
      <Banner />
      <div className="flex min-h-0 flex-1 flex-col">
        <Messages />
      </div>
      <Composer />
    </>
  );
}
