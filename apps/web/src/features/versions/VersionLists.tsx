import type { VersionChange, VersionCommit, VersionExcluded } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';

const CHANGE_LABELS: Record<VersionChange['kind'], string> = { added: '新增', modified: '修改', deleted: '删除' };
const CHANGE_TONES: Record<VersionChange['kind'], string> = {
  added: 'text-success',
  modified: 'text-muted-foreground',
  deleted: 'text-destructive-foreground',
};
export function ChangeList({
  changes,
  select,
  disabled,
  emptyLabel = '没有可记录的文件改动。',
}: {
  changes: VersionChange[];
  select?: (path: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  if (!changes.length) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <ul className="max-h-52 divide-y divide-border overflow-auto text-sm">
      {changes.map((file) => (
        <li key={file.path} className="flex items-start gap-3 py-2">
          <span className={`shrink-0 text-xs leading-6 ${CHANGE_TONES[file.kind]}`}>{CHANGE_LABELS[file.kind]}</span>
          <div className="min-w-0 flex-1">
            {select ? (
              <button
                type="button"
                className="min-w-0 text-left font-mono text-xs leading-6 wrap-anywhere hover:text-accent"
                disabled={disabled}
                onClick={() => select(file.path)}
              >
                {file.path}
              </button>
            ) : (
              <span className="min-w-0 font-mono text-xs leading-6 wrap-anywhere">{file.path}</span>
            )}
            {file.untrackedOverwrite && <p className="text-xs leading-5 text-warning">将覆盖未跟踪的同名文件</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
export function ExcludedList({ excluded }: { excluded: VersionExcluded[] }) {
  if (!excluded.length) return null;
  return (
    <details className="mt-3 text-xs text-muted-foreground">
      <summary className="w-fit rounded py-1">已排除 {excluded.length} 个文件</summary>
      <ul className="mt-2 max-h-40 space-y-2 overflow-auto border-l border-border pl-3">
        {excluded.map((file) => (
          <li key={file.path} className="leading-5 wrap-anywhere">
            <span className="font-mono">{file.path}</span>
            <p>{file.reason}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
export function HistoryList({
  commits,
  selected,
  disabled,
  select,
}: {
  commits: VersionCommit[];
  selected?: string;
  disabled: boolean;
  select: (commit: string) => void;
}) {
  return (
    <ul className="max-h-64 space-y-1 overflow-auto">
      {commits.map((commit) => (
        <li key={commit.id}>
          <button
            type="button"
            className={`${buttonClass('ghost')} w-full flex-col items-start gap-1 py-2 text-left ${selected === commit.id ? 'bg-muted text-foreground' : ''}`}
            aria-pressed={selected === commit.id}
            disabled={disabled}
            onClick={() => select(commit.id)}
          >
            <span className="w-full text-sm wrap-anywhere">{commit.subject.trim() || '未填写说明'}</span>
            <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span className="font-mono">{commit.id.slice(0, 8)}</span>
              <time dateTime={new Date(commit.timestamp).toISOString()}>
                {new Date(commit.timestamp).toLocaleString('zh-CN')}
              </time>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
