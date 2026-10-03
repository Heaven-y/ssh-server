import { CircleAlert } from 'lucide-react';
import { memo } from 'react';
import { Streamdown } from 'streamdown';
import type { ChatItem } from './chat-reducer';
import { PermissionCard } from './PermissionCard';
import { ToolCard } from './ToolCard';
import { CompactionStatus } from './ContextStatus';

/** 单个对话条目；memo 避免流式更新时整列表重渲染（条目内容不变时引用不变） */
export const MessageItem = memo(function MessageItem({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'compaction':
      return <CompactionStatus state={item.state} incomplete={item.incomplete} />;
    case 'user':
      return (
        <div className="ml-auto max-w-[88%] rounded-xl bg-muted/70 px-4 py-3 text-[15px] leading-7 whitespace-pre-wrap break-words">
          {item.text}
        </div>
      );
    case 'assistant':
      return (
        <div className="min-w-0 text-[15px] leading-7 break-words [&_li]:leading-7 [&_p]:leading-7 [&_pre]:text-[13px] [&_pre]:leading-6">
          <Streamdown mode={item.streaming ? 'streaming' : 'static'} isAnimating={item.streaming}>
            {item.text}
          </Streamdown>
        </div>
      );
    case 'reasoning':
      return (
        <details className="min-w-0 text-sm text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded-md py-1 select-none hover:text-foreground">思考过程</summary>
          <p className="mt-2 border-l border-border pl-4 leading-7 whitespace-pre-wrap break-words">{item.text}</p>
        </details>
      );
    case 'tool':
      return <ToolCard item={item} />;
    case 'permission':
      return <PermissionCard item={item} />;
    case 'error':
      return (
        <div role="alert" className="flex items-start gap-3 rounded-lg bg-destructive/10 px-4 py-3 text-sm leading-6">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span className="min-w-0 break-words text-destructive-foreground">{item.message}</span>
        </div>
      );
  }
});
