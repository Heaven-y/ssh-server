import { CircleAlert } from 'lucide-react';
import { memo } from 'react';
import { Streamdown } from 'streamdown';
import type { ChatItem } from './chat-reducer';
import { PermissionCard } from './PermissionCard';
import { ToolCard } from './ToolCard';
import { CompactionStatus } from './ContextStatus';
import type { ExpandedProps } from './timeline-model';
import { SessionForkPoint } from './SessionForkPoint';

/** 单个对话条目；memo 避免流式更新时整列表重渲染（条目内容不变时引用不变） */
export const MessageItem = memo(function MessageItem({
  item,
  expanded,
  onExpandedChange,
}: { item: ChatItem } & ExpandedProps) {
  switch (item.kind) {
    case 'fork-point':
      return <SessionForkPoint pointId={item.pointId} />;
    case 'compaction':
      return <CompactionStatus state={item.state} incomplete={item.incomplete} />;
    case 'user':
      return <div className="conversation-user">{item.text}</div>;
    case 'assistant':
      return (
        <div className="conversation-assistant">
          <Streamdown mode={item.streaming ? 'streaming' : 'static'} isAnimating={item.streaming}>
            {item.text}
          </Streamdown>
        </div>
      );
    case 'reasoning':
      return (
        <details
          className="min-w-0 text-[13px] text-muted-foreground"
          open={expanded}
          onToggle={(event) => {
            if (event.currentTarget.open !== expanded) onExpandedChange?.(event.currentTarget.open);
          }}
        >
          <summary className="w-fit cursor-pointer rounded-lg py-1 leading-6 select-none hover:text-foreground">
            思考过程
          </summary>
          <p className="mt-1 border-l border-border pl-4 leading-6 whitespace-pre-wrap break-words">{item.text}</p>
        </details>
      );
    case 'tool':
      return <ToolCard item={item} expanded={expanded} onExpandedChange={onExpandedChange} />;
    case 'permission':
      return <PermissionCard item={item} />;
    case 'error':
      return (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-destructive/8 px-3 py-2 text-[13px] leading-6"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span className="min-w-0 break-words text-destructive-foreground">{item.message}</span>
        </div>
      );
  }
});
