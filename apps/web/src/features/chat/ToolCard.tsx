import { CircleCheck, CircleX, LoaderCircle, Terminal, Wrench } from 'lucide-react';
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
    <span className="flex items-center gap-1 text-accent">
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
    <details className="group rounded-md border border-border bg-card text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 marker:hidden">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">{name}</span>
        {arg && <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{arg}</code>}
        {summary && <span className="shrink-0 text-xs text-muted-foreground">{summary}</span>}
        <span className="ml-auto shrink-0 text-xs">
          <StatusLabel item={item} />
        </span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
        <pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {JSON.stringify(item.input, null, 2)}
        </pre>
        {item.output !== undefined && (
          <pre className="max-h-96 overflow-auto rounded bg-background p-2 font-mono text-xs whitespace-pre-wrap">
            {item.output || '（无输出）'}
          </pre>
        )}
      </div>
    </details>
  );
}
