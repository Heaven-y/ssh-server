import { useEffect, useRef, useState } from 'react';
import { FileText, Folder, ArrowUp, Home, RefreshCw, X } from 'lucide-react';
import type { SshConsoleDirectory, SshConsolePreview } from '@agentdeck/shared';
import { sshConsoleApi } from '../../lib/ssh-console-api';
import { buttonClass, inputClass } from '../../ui/styles';
import { consoleError, formatBytes } from './console-state';

function useConsoleFiles(serverId: string, initialDirectory: string, active: boolean) {
  const [path, setPath] = useState(initialDirectory);
  const [directory, setDirectory] = useState<SshConsoleDirectory>();
  const [preview, setPreview] = useState<SshConsolePreview>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void sshConsoleApi
      .directory(serverId, path, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setDirectory(value);
          setLoading(false);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(consoleError(reason));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [serverId, path, reload, active]);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!active) pending.current?.abort();
  }, [active]);
  const navigate = (next: string) => {
    pending.current?.abort();
    setPath(next);
    setDirectory(undefined);
    setPreview(undefined);
    setError('');
    setLoading(true);
    setPreviewLoading(false);
    setReload((value) => value + 1);
  };
  const open = async (file: string) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setPreview(undefined);
    setPreviewLoading(true);
    setError('');
    try {
      const value = await sshConsoleApi.preview(serverId, file, controller.signal);
      if (!controller.signal.aborted) setPreview(value);
    } catch (reason) {
      if (!controller.signal.aborted) setError(consoleError(reason));
    } finally {
      if (pending.current === controller) setPreviewLoading(false);
    }
  };
  return {
    directory,
    preview,
    error,
    loading,
    previewLoading,
    navigate,
    open,
    path,
    closePreview: () => {
      pending.current?.abort();
      setPreview(undefined);
      setPreviewLoading(false);
    },
  };
}
type Browser = ReturnType<typeof useConsoleFiles>;

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
      <FileNavigation browser={browser} disabled={!active} />
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
function FileNavigation({ browser, disabled }: { browser: Browser; disabled: boolean }) {
  const [input, setInput] = useState(browser.path);
  const path = browser.directory?.path ?? browser.path;
  const [previous, setPrevious] = useState(path);
  if (path !== previous) {
    setPrevious(path);
    setInput(path);
  }
  return (
    <form
      className="flex shrink-0 gap-1 border-b border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (input.trim()) browser.navigate(input.trim());
      }}
    >
      <button
        type="button"
        className={buttonClass('ghost')}
        aria-label="上级目录"
        disabled={disabled || !browser.directory}
        onClick={() => browser.navigate(browser.directory!.parentPath)}
      >
        <ArrowUp aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        className={buttonClass('ghost')}
        aria-label="服务器主目录"
        disabled={disabled}
        onClick={() => browser.navigate('~')}
      >
        <Home aria-hidden className="size-4" />
      </button>
      <input
        aria-label="服务器浏览路径"
        className={`${inputClass} min-w-0 flex-1 font-mono`}
        disabled={disabled}
        value={input}
        onChange={(event) => setInput(event.target.value)}
      />
      <button type="submit" className={buttonClass('outline')} disabled={disabled}>
        前往
      </button>
      <button
        type="button"
        className={buttonClass('ghost')}
        aria-label="刷新只读目录"
        disabled={disabled}
        onClick={() => browser.navigate(path)}
      >
        <RefreshCw aria-hidden className="size-4" />
      </button>
    </form>
  );
}
function FileList({ browser, disabled }: { browser: Browser; disabled: boolean }) {
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
