import { useId, useState } from 'react';
import type { VersionDiscardPreview } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { ChangeList, ExcludedList } from '../versions/VersionLists';

export function DiscardConfirmation({
  preview,
  busy,
  confirm,
  cancel,
}: {
  preview: VersionDiscardPreview;
  busy: boolean;
  confirm(): void;
  cancel(): void;
}) {
  const id = useId();
  const [checked, setChecked] = useState(false);
  return (
    <section aria-label="单文件放弃预览" className="space-y-3 rounded-lg border border-warning/60 p-3">
      <h3 className="text-sm font-medium">放弃本地文件改动</h3>
      <p className="text-xs leading-6 wrap-anywhere">
        {preview.path} · {preview.head ? `恢复到${preview.head.slice(0, 8)}` : '尚无保存版本，将删除新增文件'}
        。只操作磁盘，未保存编辑缓冲保持；后续服务器删除需在同步详情中确认。
      </p>
      <ChangeList changes={preview.changes} emptyLabel="没有需要放弃的磁盘差异。" />
      <ExcludedList excluded={preview.excluded} />
      <label htmlFor={id} className="flex items-start gap-2 text-sm leading-6">
        <input
          id={id}
          type="checkbox"
          className="mt-1 accent-accent"
          checked={checked}
          disabled={busy || !preview.changes.length}
          onChange={(event) => setChecked(event.target.checked)}
        />
        我已核对上述覆盖或删除，确认放弃此本地文件改动
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass('outline')} disabled={busy} onClick={cancel}>
          取消放弃
        </button>
        <button
          type="button"
          className={buttonClass('danger')}
          disabled={busy || !checked || !preview.changes.length}
          onClick={confirm}
        >
          确认放弃此文件
        </button>
      </div>
    </section>
  );
}
