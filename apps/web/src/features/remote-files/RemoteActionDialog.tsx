import { useEffect, useRef, useState } from 'react';
import type { RemoteBrowseSession, RemoteFileActionInput, RemoteFilePreflight } from '@ssh-server/shared';
import { api } from '../../lib/api';
import { buttonClass, inputClass } from '../../ui/styles';
import { RemoteDialog } from './RemoteDialog';
import { RemoteFolderPicker } from './RemoteFolderPicker';

export const ACTION_LABELS = { mkdir: '新建目录', rename: '重命名', move: '移动到…', copy: '复制到…', delete: '删除' };
type Props = {
  workspaceId: string;
  session: RemoteBrowseSession;
  input: RemoteFileActionInput;
  currentPath: string;
  connect(signal: AbortSignal): Promise<RemoteBrowseSession>;
  submitted(): void;
  close(): void;
};

export function RemoteActionDialog({ workspaceId, session, input, currentPath, connect, submitted, close }: Props) {
  const [destination, setDestination] = useState(input.destination ?? '');
  const [preview, setPreview] = useState<RemoteFilePreflight>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  async function inspect() {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError('');
    setConfirmed(false);
    setPreview(undefined);
    try {
      const result = await api.preflightRemoteFile(
        workspaceId,
        session.id,
        { ...input, destination: input.kind === 'delete' ? undefined : destination },
        active.signal,
      );
      if (!active.signal.aborted) setPreview(result);
    } catch (reason) {
      if (!active.signal.aborted) setError(reason instanceof Error ? reason.message : '无法预检操作');
    } finally {
      if (!active.signal.aborted) setBusy(false);
    }
  }
  async function submit() {
    if (!preview || !confirmed || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.submitRemoteFileTask(workspaceId, preview.id);
      submitted();
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提交结果未确认；可再次提交同一预检，不会重复执行。');
      setBusy(false);
    }
  }
  const updateDestination = (value: string) => {
    controller.current?.abort();
    setBusy(false);
    setDestination(value);
    setPreview(undefined);
    setConfirmed(false);
  };
  return (
    <RemoteDialog title={ACTION_LABELS[input.kind]} close={close}>
      <form
        className="space-y-4 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void inspect();
        }}
      >
        <p className="text-xs">
          服务器：<span className="font-mono">{session.sshHost}</span>
        </p>
        {input.source && (
          <p className="break-all text-xs">
            源：<span className="font-mono">{input.source}</span>
          </p>
        )}
        {input.kind !== 'delete' && (
          <div className="space-y-2">
            <label className="block text-xs" htmlFor="remote-action-destination">
              完整目标路径
              <input
                id="remote-action-destination"
                className={`${inputClass} mt-1 font-mono`}
                value={destination}
                onChange={(event) => updateDestination(event.target.value)}
                required
                autoFocus
                disabled={busy}
              />
            </label>
            {['move', 'copy'].includes(input.kind) && (
              <button type="button" className={buttonClass('ghost')} disabled={busy} onClick={() => setPicker(true)}>
                选择目标目录
              </button>
            )}
            <p className="text-xs text-muted-foreground">同名目标不会覆盖，目录不会合并。相对路径从固定同步根解析。</p>
          </div>
        )}
        {input.kind === 'delete' && (
          <p className="text-xs text-destructive">删除作用于所选对象；目录内文件会一并删除，无法自动回滚。</p>
        )}
        <button type="submit" className={buttonClass('outline')} disabled={busy}>
          {busy ? '正在处理…' : '预检操作影响'}
        </button>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {preview && (
          <ActionPreview
            preview={preview}
            confirmed={confirmed}
            busy={busy}
            confirm={setConfirmed}
            submit={() => void submit()}
          />
        )}
      </form>
      {picker && (
        <RemoteFolderPicker
          workspaceId={workspaceId}
          initialPath={currentPath}
          connect={connect}
          close={() => setPicker(false)}
          choose={(directory) => {
            updateDestination(destinationIn(directory, input.source));
            setPicker(false);
          }}
        />
      )}
    </RemoteDialog>
  );
}

function ActionPreview({
  preview,
  confirmed,
  busy,
  confirm,
  submit,
}: {
  preview: RemoteFilePreflight;
  confirmed: boolean;
  busy: boolean;
  confirm(value: boolean): void;
  submit(): void;
}) {
  return (
    <section aria-label="文件操作影响" className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <p className="break-all">源：{preview.source ?? '—'}</p>
      <p className="break-all">目标：{preview.destination ?? '—'}</p>
      <p>
        已核对 {preview.entries} 项，{preview.files} 个文件，{preview.bytes.toLocaleString()} 字节。
      </p>
      {preview.crossFilesystem && <p>跨文件系统移动会先复制并核对，成功后才移除源。</p>}
      {preview.affectedWorkspaces.map((workspace) => (
        <p key={workspace.id}>
          涉及工作区：{workspace.name}（{workspace.remoteRoot}）
          {workspace.sourceFiles !== undefined &&
            `；源范围 ${workspace.sourceFiles} 个同步文件，目标范围 ${workspace.destinationFiles ?? 0} 个。`}
        </p>
      ))}
      {preview.warnings.map((warning) => (
        <p key={warning} className="text-destructive">
          {warning}
        </p>
      ))}
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={confirmed}
          onChange={(event) => confirm(event.target.checked)}
          disabled={!preview.canSubmit || busy}
        />
        <span>已核对服务器、源与目标以及以上影响，确认执行。</span>
      </label>
      <button
        type="button"
        className={buttonClass(preview.kind === 'delete' ? 'outline' : 'primary')}
        disabled={!preview.canSubmit || !confirmed || busy}
        onClick={submit}
      >
        确认执行
      </button>
    </section>
  );
}

function destinationIn(directory: string, source?: string) {
  return `${directory.replace(/\/$/, '')}/${source?.split('/').at(-1) ?? ''}`;
}
