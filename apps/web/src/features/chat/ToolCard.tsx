import { ChevronRight, CircleAlert, CircleCheck, CircleX, LoaderCircle, Wrench } from 'lucide-react';
import type { ChatItem } from './chat-reducer';
import type { ExpandedProps } from './timeline-model';
import { finiteCount, formatDuration } from './chat-metrics';
import { StatisticsLine } from './StatisticsLine';
import { shortToolName, toolPrimaryArgument } from './tool-presentation';

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

/** 原生工具名可能是 `mcp__<服务器>__<工具>`，界面只显示最后一段 */
export { shortToolName } from './tool-presentation';

function StatusLabel({ item }: { item: ToolItem }) {
  if (item.status === 'incomplete')
    return (
      <span className="flex items-center gap-1 text-warning">
        <CircleAlert aria-hidden className="size-3.5" />
        结果未返回
      </span>
    );
  if (item.status === 'running')
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
        运行中
      </span>
    );
  return item.isError ? (
    <span className="flex items-center gap-1 text-destructive-foreground">
      <CircleX aria-hidden className="size-3.5" />
      失败
    </span>
  ) : (
    <span className="flex items-center gap-1 text-success">
      <CircleCheck aria-hidden className="size-3.5" />
      完成
    </span>
  );
}

/** 工具调用卡片：默认折叠，展开显示参数与结果 */
export function ToolCard({ item, expanded, onExpandedChange }: { item: ToolItem } & ExpandedProps) {
  const name = shortToolName(item.name);
  const arg = toolPrimaryArgument(item.input);

  return (
    <details
      className="tool-card group/tool min-w-0 rounded-lg text-[13px]"
      open={expanded}
      onToggle={(event) => {
        if (event.currentTarget.open !== expanded) onExpandedChange?.(event.currentTarget.open);
      }}
    >
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 marker:hidden hover:bg-muted/50">
        <Wrench aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="min-w-0 max-w-full break-words">{name}</span>
            {arg && (
              <code title={arg} className="min-w-0 max-w-full truncate font-mono text-xs text-muted-foreground">
                {arg}
              </code>
            )}
          </span>
          {item.status === 'incomplete' && (
            <span className="mt-0.5 block text-xs text-warning">需核对实际执行状态</span>
          )}
        </span>
        <span className="shrink-0 text-xs">
          <StatusLabel item={item} />
        </span>
        {finiteCount(item.durationMs) && (
          <span
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
            title={item.timingSource === 'observed' ? '工作台记录的耗时' : 'CLI 报告的耗时'}
          >
            {formatDuration(item.durationMs)}
          </span>
        )}
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/tool:rotate-90"
        />
      </summary>
      <div className="mt-1 mr-2 mb-2 ml-3.5 flex min-w-0 flex-col gap-3 border-l border-border py-1 pl-4">
        {item.progress && <p className="text-xs text-muted-foreground">{item.progress}</p>}
        {item.usage && <StatisticsLine statistics={{ ...item, scope: 'step' }} />}
        <div className="min-w-0">
          <p className="mb-1 text-xs text-muted-foreground">输入</p>
          <pre className="max-h-48 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap break-words text-muted-foreground">
            {JSON.stringify(item.input, null, 2)}
          </pre>
        </div>
        {item.output !== undefined && (
          <div className="min-w-0">
            <p className="mb-1 text-xs text-muted-foreground">输出</p>
            <pre className="max-h-96 overflow-auto rounded-lg bg-sidebar p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words">
              {item.output || '（无输出）'}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}
