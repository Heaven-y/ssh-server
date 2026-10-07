import { FolderPlus, CircleHelp } from 'lucide-react';
import { buttonClass } from '../../ui/styles';

export function RemoteActionToolbar({ disabled, create }: { disabled: boolean; create(): void }) {
  return (
    <div
      className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1"
      aria-label="服务器文件操作"
    >
      <span className="text-xs text-muted-foreground">名称 · 文件夹优先</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={buttonClass('ghost')}
          aria-label="新建文件夹"
          title="新建文件夹（Ctrl+Shift+N）"
          disabled={disabled}
          onClick={create}
        >
          <FolderPlus aria-hidden className="size-4" />
        </button>
        <details className="relative">
          <summary
            className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label="文件操作帮助"
            title="文件操作帮助"
          >
            <CircleHelp aria-hidden className="size-4" />
          </summary>
          <p className="absolute right-0 top-full z-20 w-56 rounded-lg border border-border bg-card p-3 text-xs leading-6 shadow-lg">
            单击选中，双击或 Enter 打开文件夹。右键或 Shift+F10 打开菜单；F2 重命名，Delete
            删除。拖到文件夹后确认移动，按 Alt 拖动可复制。
          </p>
        </details>
      </div>
    </div>
  );
}
