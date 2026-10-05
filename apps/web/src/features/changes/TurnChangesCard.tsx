import { FileDiff } from 'lucide-react';
import { buttonClass } from '../../ui/styles';
import { useTurnChanges } from './use-turn-changes';

export function TurnChangesCard({ workspaceId, open }: { workspaceId: string; open(turnId: string): void }) {
  const { records } = useTurnChanges(workspaceId);
  const record = records.find((value) => value.phase !== 'running');
  if (!record) return null;
  return (
    <section
      aria-label="最近一轮本地改动"
      className="mx-4 mb-1 shrink-0 rounded-lg border border-border px-3 py-2 sm:mx-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <FileDiff aria-hidden className="size-4 shrink-0" />
          <span>
            最近一轮 · {record.phase === 'unavailable' ? '采集不可用' : `${record.changes.length}个文件`}
            {record.phase === 'incomplete' ? ' · 未完整结束' : ''}
          </span>
        </div>
        <button type="button" className={buttonClass('ghost')} onClick={() => open(record.turnId)}>
          查看本轮改动
        </button>
      </div>
      {record.message && <p className="mt-1 text-xs leading-5 text-muted-foreground">{record.message}</p>}
    </section>
  );
}
