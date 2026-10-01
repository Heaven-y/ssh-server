import { CircleAlert } from 'lucide-react';
import { memo } from 'react';
import { Streamdown } from 'streamdown';
import type { ChatItem } from './chat-reducer';
import { PermissionCard } from './PermissionCard';
import { ToolCard } from './ToolCard';

/** 单个对话条目；memo 避免流式更新时整列表重渲染（条目内容不变时引用不变） */
export const MessageItem = memo(function MessageItem({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="ml-auto max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{item.text}</div>
      );
    case 'assistant':
      return (
        <div className="text-sm leading-relaxed">
          <Streamdown mode={item.streaming ? 'streaming' : 'static'} isAnimating={item.streaming}>
            {item.text}
          </Streamdown>
        </div>
      );
    case 'reasoning':
      return (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer select-none">思考过程</summary>
          <p className="mt-1 border-l-2 border-border pl-3 whitespace-pre-wrap">{item.text}</p>
        </details>
      );
    case 'tool':
      return <ToolCard item={item} />;
    case 'permission':
      return <PermissionCard item={item} />;
    case 'error':
      return (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive bg-card px-3 py-2 text-sm"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span className="text-destructive-foreground">{item.message}</span>
        </div>
      );
  }
});
