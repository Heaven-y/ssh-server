import { ArrowDown, CircleAlert, X } from 'lucide-react';
import { useId } from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import type { Workspace } from '@ssh-server/shared';
import { buttonClass, inputClass } from '../../ui/styles';
import { useChat } from './chat-store';
import { Composer } from './Composer';
import { MessageItem } from './MessageItem';

function Banner() {
  const banner = useChat((s) => s.banner);
  const dismiss = useChat((s) => s.dismissBanner);
  if (!banner) return null;
  return (
    <div role="alert" className="flex items-start gap-2 border-b border-destructive bg-card px-4 py-2 text-sm">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <span className="flex-1 text-destructive-foreground">{banner}</span>
      <button type="button" aria-label="关闭提示" className="text-muted-foreground hover:text-foreground" onClick={dismiss}>
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
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {actual && <span className="font-mono">实际模型：{actual}</span>}
      <label htmlFor={id}>模型</label>
      <input
        id={id}
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder="跟随本地配置"
        spellCheck={false}
        className={`${inputClass} w-44 py-1 font-mono text-xs`}
      />
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
      className={`${buttonClass('outline')} absolute bottom-3 left-1/2 -translate-x-1/2 bg-card shadow`}
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
    return <p className="m-auto text-sm text-muted-foreground">发送一条消息开始新会话。Agent 会在服务器目录中执行命令。</p>;

  return (
    <StickToBottom className="relative min-h-0 flex-1" resize="smooth" initial="instant">
      {/* 流式输出期间 aria-busy，结束后读屏器再播报整段内容，避免逐字打断 */}
      <StickToBottom.Content
        className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4"
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
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {sessionId ? `会话 ${sessionId.slice(0, 8)}` : '新会话'}
          <span className="ml-2 text-xs text-muted-foreground">Claude · {workspace.name}</span>
        </h1>
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
