import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, Folder } from 'lucide-react';
import type { RemoteBrowseSession, RemoteDirectory } from '@ssh-server/shared';
import { api } from '../../lib/api';
import { buttonClass, inputClass } from '../../ui/styles';
import { RemoteDialog } from './RemoteDialog';

type Props = {
  workspaceId: string;
  initialPath: string;
  connect(signal: AbortSignal): Promise<RemoteBrowseSession>;
  choose(path: string): void;
  close(): void;
};

function useFolderSession(workspaceId: string, connect: Props['connect']) {
  const [session, setSession] = useState<RemoteBrowseSession>();
  const [error, setError] = useState('');
  useEffect(() => {
    let opened: RemoteBrowseSession | undefined;
    const controller = new AbortController();
    void connect(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) void api.closeRemoteBrowseSession(workspaceId, value.id).catch(() => undefined);
        else {
          opened = value;
          setSession(value);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法打开目录选择');
      });
    return () => {
      controller.abort();
      if (opened) void api.closeRemoteBrowseSession(workspaceId, opened.id).catch(() => undefined);
    };
  }, [connect, workspaceId]);
  return { session, error };
}

export function RemoteFolderPicker({ workspaceId, initialPath, connect, choose, close }: Props) {
  const { session, error: connectionError } = useFolderSession(workspaceId, connect);
  const [request, setRequest] = useState({ path: initialPath, cursor: undefined as string | undefined });
  const query = useQuery({
    queryKey: ['remote-folder-picker', workspaceId, session?.id, request],
    queryFn: ({ signal }) => api.listRemoteFiles(workspaceId, session!.id, request, signal),
    enabled: !!session,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const error = connectionError || query.error?.message || '';
  const loading = (!session && !connectionError) || query.isFetching;
  const navigate = (path: string) => setRequest({ path, cursor: undefined });
  return (
    <RemoteDialog title="选择服务器目标目录" close={close}>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">选择同一服务器上的目录，浏览位置不会改变工作区同步根。</p>
        <PickerNavigation path={query.data?.path ?? request.path} disabled={loading || !session} navigate={navigate} />
        <PickerEntries
          directory={query.data}
          loading={loading}
          error={error}
          navigate={navigate}
          choose={choose}
          close={close}
          next={() => {
            if (query.data) setRequest({ path: query.data.path, cursor: query.data.nextCursor });
          }}
        />
      </div>
    </RemoteDialog>
  );
}

function PickerNavigation({
  path,
  disabled,
  navigate,
}: {
  path: string;
  disabled: boolean;
  navigate(path: string): void;
}) {
  const [input, setInput] = useState(path);
  const [displayed, setDisplayed] = useState(path);
  if (displayed !== path) {
    setDisplayed(path);
    setInput(path);
  }
  return (
    <>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(input);
        }}
      >
        <label className="min-w-0 flex-1 text-xs">
          目录路径
          <input
            className={`${inputClass} mt-1 font-mono`}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
        <button type="submit" className={`${buttonClass('outline')} self-end`} disabled={disabled}>
          前往
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={disabled || path === '/'}
          onClick={() => navigate(path.slice(0, path.lastIndexOf('/')) || '/')}
        >
          <ArrowUp aria-hidden className="size-4" />
          上级
        </button>
        <button type="button" className={buttonClass('ghost')} disabled={disabled} onClick={() => navigate('')}>
          工作区目录
        </button>
      </div>
    </>
  );
}

function PickerEntries({
  directory,
  loading,
  error,
  navigate,
  choose,
  close,
  next,
}: {
  directory?: RemoteDirectory;
  loading: boolean;
  error: string;
  navigate(path: string): void;
  choose(path: string): void;
  close(): void;
  next(): void;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="text-xs">
          正在读取目录…
        </p>
      )}
      <ul className="max-h-64 space-y-1 overflow-auto" aria-label="可选目标目录">
        {directory?.entries
          .filter((entry) => entry.type === 'directory')
          .map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                className={`${buttonClass('ghost')} w-full justify-start`}
                disabled={loading}
                onClick={() => navigate(entry.path)}
              >
                <Folder aria-hidden className="size-4 shrink-0" />
                <span className="truncate">{entry.name}</span>
              </button>
            </li>
          ))}
      </ul>
      {directory?.nextCursor && (
        <button type="button" className={buttonClass('outline')} disabled={loading} onClick={next}>
          下一页目录
        </button>
      )}
      <p className="break-all font-mono text-xs">{directory?.path}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClass('ghost')} onClick={close}>
          取消
        </button>
        <button
          type="button"
          className={buttonClass('primary')}
          disabled={loading || !!error || !directory}
          onClick={() => {
            if (directory) choose(directory.path);
          }}
        >
          使用此目录
        </button>
      </div>
    </>
  );
}
