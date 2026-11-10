import { FileText, Folder, X } from 'lucide-react';
import type { SshConsolePreview } from '@agentdeck/shared/ssh';
import { buttonClass } from '../../../ui/styles';
import { formatBytes } from './console-state';
import { useConsoleFiles, type ConsoleFileBrowser } from './use-console-files';
import { ConsoleFileNavigation } from './ConsoleFileNavigation';

export function ConsoleFiles({
  serverId,
  initialDirectory,
  active,
}: {
  serverId: string;
  initialDirectory: string;
  active: boolean;
}) {
  const browser = useConsoleFiles(serverId, initialDirectory, active);
  return (
    <section aria-label="只读服务器文件" className="flex min-h-0 flex-1 flex-col">
      <ConsoleFileNavigation browser={browser} disabled={!active} />
      <p className="shrink-0 px-5 py-2 text-xs text-muted-foreground">只读浏览 · 文本预览最多 256 KiB</p>
      {browser.error && (
        <p role="alert" className="px-5 py-2 text-sm text-destructive-foreground">
          {browser.error}
        </p>
      )}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {(browser.loading || (!browser.directory && !browser.error)) && active && (
          <p role="status" className="text-sm">
            正在读取目录…
          </p>
        )}
        <FileList browser={browser} disabled={!active} />
        {browser.previewLoading && (
          <p role="status" className="text-sm">
            正在读取文件预览…
          </p>
        )}
        {browser.preview && <FilePreview preview={browser.preview} close={browser.closePreview} />}
      </div>
    </section>
  );
}
function FileModified({ timestamp }: { timestamp: number | null }) {
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return (
    <time dateTime={date.toISOString()} className="hidden shrink-0 text-xs text-muted-foreground sm:block">
      {date.toLocaleString()}
    </time>
  );
}
function FileList({ browser, disabled }: { browser: ConsoleFileBrowser; disabled: boolean }) {
  if (!browser.directory) return null;
  return (
    <>
      {browser.directory.truncated && (
        <p className="text-sm text-muted-foreground">目录条目较多，仅显示本次读取范围。</p>
      )}
      {!browser.directory.entries.length && <p className="text-sm text-muted-foreground">目录为空。</p>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {browser.directory.entries.map((entry) => (
          <li key={entry.path} className="flex min-w-0 items-center gap-3 px-3 py-2">
            {entry.type === 'directory' ? (
              <Folder aria-hidden className="size-4 shrink-0 text-accent" />
            ) : (
              <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            )}
            <button
              type="button"
              className="min-h-9 min-w-0 flex-1 break-all text-left text-sm hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
              disabled={disabled || !['directory', 'file'].includes(entry.type)}
              aria-label={`${entry.type === 'directory' ? '进入' : '预览'} ${entry.name}`}
              onClick={() =>
                entry.type === 'directory' ? browser.navigate(entry.path) : void browser.open(entry.path)
              }
            >
              {entry.name}
            </button>
            <FileModified timestamp={entry.modifiedAt} />
            <span className="shrink-0 text-xs text-muted-foreground">
              {entry.type === 'file'
                ? formatBytes(entry.size)
                : { directory: '目录', link: '链接', other: '其他' }[entry.type]}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
function FilePreview({ preview, close }: { preview: SshConsolePreview; close(): void }) {
  return (
    <section aria-label="文件只读预览" className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-3 border-b border-border bg-muted px-3 py-2">
        <h3 className="min-w-0 flex-1 break-all font-mono text-xs">{preview.path}</h3>
        <button type="button" className={buttonClass('ghost')} aria-label="关闭文件预览" onClick={close}>
          <X aria-hidden className="size-4" />
        </button>
      </div>
      {preview.binary ? (
        <p className="p-4 text-sm text-muted-foreground">该文件为二进制内容，无法显示文本预览。</p>
      ) : (
        <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs leading-5">
          {preview.text}
        </pre>
      )}
      {preview.truncated && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          仅显示前 256 KiB，文件共 {formatBytes(preview.size)}。
        </p>
      )}
    </section>
  );
}
