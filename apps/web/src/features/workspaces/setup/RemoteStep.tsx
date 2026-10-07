import { useEffect, useId, useRef, useState } from 'react';
import type { RemoteDirectory, WorkspaceInput } from '@ssh-server/shared';
import { api } from '../../../lib/api';
import { buttonClass, inputClass } from '../../../ui/styles';
import { DirectoryPicker } from './DirectoryPicker';
import { useCancelableRequest } from './use-cancelable-request';

export function RemoteStep({
  input,
  change,
  onBrowsingChange,
}: {
  input: WorkspaceInput;
  change(patch: Partial<WorkspaceInput>): void;
  onBrowsingChange?(blocked: boolean): void;
}) {
  const id = useId();
  const session = useRef<string | undefined>(undefined);
  const [directory, setDirectory] = useState<RemoteDirectory>();
  const [size, setSize] = useState<{ path: string; bytes: number }>();
  const request = useCancelableRequest();
  useEffect(
    () => () => {
      if (session.current) void api.closeSetupRemote(session.current).catch(() => undefined);
      session.current = undefined;
    },
    [],
  );
  useEffect(() => () => onBrowsingChange?.(false), [onBrowsingChange]);
  const browse = async (path?: string, cursor?: string) => {
    onBrowsingChange?.(true);
    setSize(undefined);
    const result = await request.run(async (signal) => {
      if (!session.current) {
        const opened = await api.openSetupRemote({ sshHost: input.sshHost }, signal);
        if (signal.aborted) {
          void api.closeSetupRemote(opened.id).catch(() => undefined);
          signal.throwIfAborted();
        }
        session.current = opened.id;
      }
      return api.readSetupRemote(session.current, { path: path ?? '~', cursor }, signal);
    });
    if (result) {
      setDirectory(result);
      change({ remoteDir: result.path });
      onBrowsingChange?.(false);
    }
  };
  const measure = async () => {
    if (!session.current || !directory) return;
    const result = await request.run((signal) => api.setupRemoteSize(session.current!, directory.path, signal));
    if (result) setSize(result);
  };
  const parent = directory?.path.replace(/\/[^/]+\/?$/, '') || '/';
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor={id} className="mb-2 block text-sm font-medium">
          服务器目录
        </label>
        <input
          id={id}
          className={`${inputClass} font-mono`}
          value={input.remoteDir}
          onChange={(event) => {
            request.abort();
            setDirectory(undefined);
            setSize(undefined);
            onBrowsingChange?.(false);
            change({ remoteDir: event.target.value });
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        可手动填写以 / 或 ~/ 开头的普通目录，或逐级浏览。浏览仅读取目录元数据，不写入目录或自动扫描文件。
      </p>
      <button
        type="button"
        className={`${buttonClass('outline')} self-start`}
        disabled={request.busy}
        onClick={() => void browse(input.remoteDir || '~')}
      >
        {request.busy ? '正在读取…' : '浏览服务器目录'}
      </button>
      {directory && (
        <>
          <DirectoryPicker
            {...directory}
            parent={parent}
            busy={request.busy}
            browse={(path, cursor) => void browse(path, cursor)}
          />
          <button
            type="button"
            className={`${buttonClass('ghost')} self-start`}
            disabled={request.busy}
            onClick={() => void measure()}
          >
            按需统计此目录占用
          </button>
        </>
      )}
      {size && (
        <p role="status" className="text-xs text-muted-foreground wrap-anywhere">
          {size.path}：{(size.bytes / 1024 / 1024).toFixed(2)} MiB（磁盘占用）
        </p>
      )}
      {request.error && (
        <p role="alert" className="text-xs text-destructive-foreground">
          {request.error}
        </p>
      )}
    </div>
  );
}
