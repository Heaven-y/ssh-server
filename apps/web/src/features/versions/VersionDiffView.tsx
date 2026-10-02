import { useEffect, useId, useRef, useState } from 'react';
import type { VersionDiff, VersionRestorePreview } from '@ssh-server/shared';
import { buttonClass, inputClass } from '../../ui/styles';
import { ChangeList, ExcludedList } from './VersionLists';

export type VersionSelection = { commit?: string; path?: string };
type DiffProps = {
  selection: VersionSelection;
  files: string[];
  diff?: VersionDiff;
  loading: boolean;
  error?: string;
  busy: boolean;
  select(selection: VersionSelection): void;
  retry(): void;
  prepare(): void;
};
const diffTitle = (selection: VersionSelection) =>
  selection.commit ? `版本 ${selection.commit.slice(0, 8)} 的差异` : '当前未记录差异';
export function VersionDiffView({ selection, files, diff, loading, error, busy, select, retry, prepare }: DiffProps) {
  const id = useId();
  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label="版本差异">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{diffTitle(selection)}</h3>
        {selection.commit && (
          <button type="button" className={buttonClass('outline')} disabled={busy} onClick={prepare}>
            {selection.path ? '预览恢复此文件' : '预览恢复整个版本'}
          </button>
        )}
      </div>
      <label htmlFor={id} className="block text-xs text-muted-foreground">
        查看文件
        <select
          id={id}
          className={`${inputClass} mt-1 font-mono text-xs`}
          value={selection.path || ''}
          disabled={busy || !files.length}
          onChange={(event) => select({ commit: selection.commit, path: event.target.value || undefined })}
        >
          <option value="">全部文件</option>
          {files.map((file) => (
            <option key={file} value={file}>
              {file}
            </option>
          ))}
        </select>
      </label>
      {loading && (
        <p role="status" className="text-xs text-muted-foreground">
          正在读取差异…
        </p>
      )}
      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
          <button type="button" className={buttonClass('outline')} disabled={busy} onClick={retry}>
            重新读取差异
          </button>
        </div>
      )}
      {diff && (
        <>
          {diff.truncated && (
            <p role="status" className="text-xs leading-5 text-warning">
              差异较大，当前显示已截断。请选择单个文件缩小范围。
            </p>
          )}
          <pre
            tabIndex={0}
            aria-label="文件差异内容"
            className="max-h-80 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-6 whitespace-pre"
          >
            {diff.text || '没有文本差异。二进制文件的变更以文件列表或 Git 提示为准。'}
          </pre>
        </>
      )}
    </section>
  );
}

function scrollPreviewWithinDialog(element: HTMLElement | null): void {
  const dialog = element?.closest('dialog');
  if (!element || !dialog) return;
  for (let container = element.parentElement; container && container !== dialog; container = container.parentElement) {
    const overflow = getComputedStyle(container).overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    // 只移动当前对话框的内容滚动区，不移动背景页面或键盘焦点。
    container.scrollBy({
      top: element.getBoundingClientRect().top - container.getBoundingClientRect().top - 12,
      behavior: 'instant',
    });
    return;
  }
}

export function RestoreConfirmation({
  preview,
  statusRevision,
  previewStatusRevision,
  busy,
  prepare,
  restore,
}: {
  preview: VersionRestorePreview;
  statusRevision?: string;
  previewStatusRevision?: string;
  busy: boolean;
  prepare(): void;
  restore(): void;
}) {
  const id = useId();
  const section = useRef<HTMLElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const stale = !previewStatusRevision || statusRevision !== previewStatusRevision;
  useEffect(() => {
    scrollPreviewWithinDialog(section.current);
  }, []);
  return (
    <section
      ref={section}
      className="space-y-3 rounded-lg border border-warning/60 bg-warning/5 p-4"
      aria-label="恢复预览"
    >
      <h3 className="text-sm font-medium">恢复预览 · {preview.commit.slice(0, 8)}</h3>
      <p className="text-xs leading-6 wrap-anywhere">
        范围：{preview.path ?? '整个工作区的历史跟踪文件'}
        。确认后将按预览覆盖或删除本地磁盘文件，再尝试同步。未保存的编辑器内容不会写入本次恢复。
      </p>
      <ChangeList changes={preview.changes} emptyLabel="没有需要恢复的文件改动。" />
      <ExcludedList excluded={preview.excluded} />
      {stale && (
        <p role="alert" className="text-xs text-warning">
          本地文件或暂存区已变化，请重新生成预览。
        </p>
      )}
      <label htmlFor={id} className="flex items-start gap-2 text-sm leading-6">
        <input
          id={id}
          type="checkbox"
          className="mt-1 accent-accent"
          checked={confirmed}
          disabled={busy || stale || !preview.changes.length}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        我已核对文件范围，确认恢复本地文件
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonClass('outline')} disabled={busy} onClick={prepare}>
          重新生成预览
        </button>
        <button
          type="button"
          className={buttonClass('danger')}
          disabled={busy || stale || !confirmed || !preview.changes.length}
          onClick={restore}
        >
          确认恢复本地文件
        </button>
      </div>
    </section>
  );
}
