import { useEffect, useRef, useState } from 'react';
import type { RemoteBrowseSession, RemoteFileEntry } from '@ssh-server/shared';
import { api } from '../../lib/api';
import { buttonClass } from '../../ui/styles';
import { RemoteDialog } from './RemoteDialog';

type WritableFile = { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> };
type SavePicker = (options: { suggestedName: string }) => Promise<{ createWritable(): Promise<WritableFile> }>;
const savePicker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;

async function transfer(url: string, signal: AbortSignal, writable: WritableFile, received: (bytes: number) => void) {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) {
    const body = (await response.json()) as { message?: string };
    throw new Error(body.message ?? '无法开始下载');
  }
  if (!response.body) throw new Error('浏览器没有返回下载流');
  const reader = response.body.getReader();
  let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    signal.throwIfAborted();
    await writable.write(chunk.value);
    bytes += chunk.value.byteLength;
    received(bytes);
  }
  signal.throwIfAborted();
}

export function RemoteDownloadDialog({
  workspaceId,
  session,
  entry,
  close,
}: {
  workspaceId: string;
  session: RemoteBrowseSession;
  entry: RemoteFileEntry;
  close(): void;
}) {
  const controller = useRef<AbortController | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  const url = api.remoteFileDownloadUrl(workspaceId, session.id, entry.path);
  async function save() {
    if (!savePicker || busy) return;
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setReceived(0);
    setError('');
    setMessage('');
    let writable: WritableFile | undefined;
    try {
      const handle = await savePicker.call(window, { suggestedName: entry.name });
      active.signal.throwIfAborted();
      writable = await handle.createWritable();
      active.signal.throwIfAborted();
      await transfer(url, active.signal, writable, setReceived);
      await writable.close();
      writable = undefined;
      setMessage('下载流已写入并关闭。保存位置由你选择，未加入工作区同步或版本记录。');
    } catch (reason) {
      active.abort();
      await writable?.abort().catch(() => undefined);
      setError(
        reason instanceof Error && reason.name !== 'AbortError' ? reason.message : '下载已取消，未确认完整保存。',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <RemoteDialog title="下载服务器文件" close={close}>
      <div className="space-y-3 p-4 text-xs">
        <p>
          服务器：<span className="font-mono">{session.sshHost}</span>
        </p>
        <p className="break-all font-mono">{entry.path}</p>
        <p>目录记录大小：{entry.size?.toLocaleString() ?? '未知'} 字节。开始下载时会重新核对文件。</p>
        <p className="leading-5 text-muted-foreground">
          下载只保存所选普通文件，不递归下载目录；文件不会自动进入本地工作区、同步或 Git。
        </p>
        {busy && <p role="status">已接收 {received.toLocaleString()} 字节…</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {savePicker ? (
          <div className="flex gap-2">
            <button type="button" className={buttonClass('primary')} disabled={busy} onClick={() => void save()}>
              选择保存位置并下载
            </button>
            {busy && (
              <button type="button" className={buttonClass('outline')} onClick={() => controller.current?.abort()}>
                取消下载
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="leading-5 text-muted-foreground">
              当前浏览器使用下载管理器；保存位置由浏览器设置决定，可在那里取消和查看完成状态。
            </p>
            <a
              className={buttonClass('primary')}
              href={url}
              download={entry.name}
              onClick={() => setMessage('已将下载请求交给浏览器。请在下载管理器查看结果。')}
            >
              开始浏览器下载
            </a>
          </div>
        )}
      </div>
    </RemoteDialog>
  );
}
