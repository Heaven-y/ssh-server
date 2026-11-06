import type { ChatItem } from './chat-reducer';
import { MessageItem } from './MessageItem';
import { shortToolName } from './ToolCard';
import { StatisticsLine } from './StatisticsLine';
import { trajectoryCategory, trajectoryStatus } from './trajectory-model';

function DetailText({ label, text }: { label: string; text: string }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 text-xs text-muted-foreground">{label}</h3>
      <pre className="max-h-[45vh] overflow-auto rounded-lg bg-sidebar p-3 font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {text || '（无输出）'}
      </pre>
    </section>
  );
}

export function TrajectoryDetails({ item }: { item: ChatItem }) {
  if (item.kind !== 'tool') return <MessageItem item={item} expanded />;
  const status = trajectoryStatus(item);
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-1 text-xs text-muted-foreground">{trajectoryCategory(item)}</p>
        <h3 className="break-words text-sm font-medium">{shortToolName(item.name)}</h3>
        {status && <p className={`mt-1 text-xs ${status.tone}`}>{status.label}</p>}
        <StatisticsLine statistics={{ ...item, scope: 'step' }} />
      </div>
      {item.progress && <p className="text-xs text-muted-foreground">{item.progress}</p>}
      <DetailText label="输入" text={JSON.stringify(item.input, null, 2) ?? ''} />
      {item.output !== undefined && <DetailText label={item.isError ? '错误输出' : '输出'} text={item.output} />}
    </div>
  );
}
