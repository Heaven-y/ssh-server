import { FolderPlus, Download, FolderOpen } from 'lucide-react';
import type { RemoteFileActionKind, RemoteFileEntry } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { ACTION_LABELS } from './RemoteActionDialog';

export function RemoteActionToolbar({
  selected,
  disabled,
  action,
  download,
  open,
}: {
  selected?: RemoteFileEntry;
  disabled: boolean;
  action(kind: RemoteFileActionKind, entry?: RemoteFileEntry): void;
  download(entry: RemoteFileEntry): void;
  open(entry: RemoteFileEntry): void;
}) {
  return (
    <div className="shrink-0 space-y-2 border-b border-border p-3">
      <div className="flex flex-wrap gap-1" aria-label="服务器文件操作">
        <button type="button" className={buttonClass('outline')} disabled={disabled} onClick={() => action('mkdir')}>
          <FolderPlus aria-hidden className="size-4" />
          新建目录
        </button>
        {selected?.type === 'directory' && (
          <button type="button" className={buttonClass('ghost')} disabled={disabled} onClick={() => open(selected)}>
            <FolderOpen aria-hidden className="size-4" />
            打开
          </button>
        )}
        {(['rename', 'move', 'copy', 'delete'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className={buttonClass('ghost')}
            disabled={disabled || !selected || selected.type === 'other'}
            onClick={() => action(kind, selected)}
          >
            {ACTION_LABELS[kind]}
          </button>
        ))}
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={disabled || selected?.type !== 'file'}
          onClick={() => {
            if (selected) download(selected);
          }}
        >
          <Download aria-hidden className="size-4" />
          下载…
        </button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        单击选择，双击或 Enter 打开目录。F2 重命名，Delete 删除；拖到目录后确认移动，按 Alt 拖动可复制。
      </p>
    </div>
  );
}
