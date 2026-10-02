import { ChevronRight, CircleAlert, CircleCheck, CircleX, LoaderCircle, Terminal, Wrench } from 'lucide-react';
import type { ChatItem } from './chat-reducer';

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

/** MCP 工具名形如 mcp__ssh-server__remote_exec，界面只显示最后一段 */
export const shortToolName = (name: string) => name.split('__').at(-1) ?? name;

/** 卡片标题中显示的关键参数 */
function keyArg(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const o = input as Record<string, unknown>;
  const v = o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url;
  return typeof v === 'string' ? v : undefined;
}

/** remote_exec 的结果文本第一行是"退出码：N（耗时 …）"，被黑名单拒绝时以"命令被拒绝"开头 */
function execSummary(output?: string): string | undefined {
  if (!output) return undefined;
  if (output.startsWith('命令被拒绝')) return '命令被拒绝';
  const code = /^退出码：(\S+?)（/.exec(output)?.[1];
  return code ? `退出码 ${code}` : undefined;
}

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
export function ToolCard({ item }: { item: ToolItem }) {
  const name = shortToolName(item.name);
  const isExec = name === 'remote_exec';
  const arg = keyArg(item.input);
  const summary = isExec ? execSummary(item.output) : undefined;
  const Icon = isExec ? Terminal : Wrench;

  return (
    <details className="group min-w-0 rounded-lg text-sm open:bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg px-3 py-2.5 marker:hidden hover:bg-muted/50">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="min-w-0 max-w-full break-words font-medium">{name}</span>
            {arg && (
              <code title={arg} className="min-w-0 max-w-full truncate font-mono text-xs text-muted-foreground">
                {arg}
              </code>
            )}
          </span>
          {summary && <span className="mt-0.5 block text-xs text-muted-foreground">{summary}</span>}
          {item.status === 'incomplete' && (
            <span className="mt-0.5 block text-xs text-warning">需核对实际执行状态</span>
          )}
        </span>
        <span className="shrink-0 text-xs">
          <StatusLabel item={item} />
        </span>
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
      </summary>
      <div className="mx-3 mb-3 flex min-w-0 flex-col gap-3 border-l border-border py-1 pl-4">
        <div className="min-w-0">
          <p className="mb-1.5 text-xs text-muted-foreground">输入</p>
          <pre className="max-h-48 overflow-auto font-mono text-xs leading-6 whitespace-pre-wrap break-words text-muted-foreground">
            {JSON.stringify(item.input, null, 2)}
          </pre>
        </div>
        {item.output !== undefined && (
          <div className="min-w-0">
            <p className="mb-1.5 text-xs text-muted-foreground">输出</p>
            <pre className="max-h-96 overflow-auto rounded-md bg-background p-3 font-mono text-xs leading-6 whitespace-pre-wrap break-words">
              {item.output || '（无输出）'}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}
