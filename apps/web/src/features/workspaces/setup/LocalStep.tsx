import { useEffect, useId, useRef, useState } from 'react';
import type { LocalDirectory, WorkspaceInput } from '@ssh-server/shared';
import { api } from '../../../lib/api';
import { buttonClass, inputClass } from '../../../ui/styles';
import { DirectoryPicker } from './DirectoryPicker';
import { useCancelableRequest } from './use-cancelable-request';

export function LocalStep({ input, change }: { input: WorkspaceInput; change(patch: Partial<WorkspaceInput>): void }) {
  const id = useId();
  const [directory, setDirectory] = useState<LocalDirectory>();
  const cursor = useRef<string | undefined>(undefined);
  const request = useCancelableRequest();
  useEffect(
    () => () => {
      if (cursor.current) void api.closeSetupLocal(cursor.current).catch(() => undefined);
    },
    [],
  );
  const browse = async (path?: string, nextCursor?: string) => {
    if (cursor.current && cursor.current !== nextCursor)
      void api.closeSetupLocal(cursor.current).catch(() => undefined);
    cursor.current = undefined;
    const result = await request.run(async (signal) => {
      const page = await api.setupLocalDirectory({ path, cursor: nextCursor }, signal);
      if (signal.aborted) {
        if (page.nextCursor) void api.closeSetupLocal(page.nextCursor).catch(() => undefined);
      }
      return page;
    });
    if (result) {
      cursor.current = result.nextCursor;
      setDirectory(result);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor={`${id}-name`} className="mb-2 block text-sm font-medium">
          工作区名称
        </label>
        <input
          id={`${id}-name`}
          className={inputClass}
          value={input.name}
          onChange={(event) => change({ name: event.target.value })}
          maxLength={100}
          autoComplete="off"
          autoFocus
        />
      </div>
      <div>
        <label htmlFor={`${id}-path`} className="mb-2 block text-sm font-medium">
          本地文件夹
        </label>
        <input
          id={`${id}-path`}
          className={`${inputClass} font-mono`}
          value={input.localDir}
          onChange={(event) => change({ localDir: event.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        选择已存在的普通目录作为本地副本。目录非空时，首次同步会合并两端文件并保留冲突副本。
      </p>
      <button
        type="button"
        className={`${buttonClass('outline')} self-start`}
        disabled={request.busy}
        onClick={() => void browse(input.localDir || undefined)}
      >
        {request.busy ? '正在浏览…' : '浏览本地文件夹'}
      </button>
      {directory && (
        <DirectoryPicker
          {...directory}
          busy={request.busy}
          browse={(path, cursor) => void browse(path, cursor)}
          choose={(localDir) => change({ localDir })}
        />
      )}
      {request.error && (
        <p role="alert" className="text-xs text-destructive-foreground">
          {request.error}
        </p>
      )}
    </div>
  );
}
