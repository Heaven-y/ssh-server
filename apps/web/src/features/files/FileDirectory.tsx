import type { WorkspaceDirectory } from '@ssh-server/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ArrowUp, FileCode2, Folder, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api';
import { buttonClass } from '../../ui/styles';

export function FileDirectory({
  workspaceId,
  disabled,
  openFile,
}: {
  workspaceId: string;
  disabled: boolean;
  openFile(relative: string): void;
}) {
  const [directory, setDirectory] = useState('');
  const list = useQuery({
    queryKey: ['files', workspaceId, directory],
    queryFn: ({ signal }) => api.listFiles(workspaceId, directory, signal),
    retry: false,
    staleTime: 0,
  });
  return (
    <section aria-label="本地文件列表" className="flex min-h-0 flex-col border-b border-border">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          className={buttonClass('ghost')}
          aria-label="返回上级目录"
          disabled={disabled || !directory}
          onClick={() => setDirectory(directory.split('/').slice(0, -1).join('/'))}
        >
          <ArrowUp aria-hidden className="size-4" />
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={directory || '/'}>
          {directory || '/'}
        </span>
        <button
          type="button"
          className={buttonClass('ghost')}
          aria-label="刷新文件列表"
          disabled={disabled || list.isFetching}
          onClick={() => {
            void list.refetch();
          }}
        >
          <RefreshCw aria-hidden className="size-4" />
        </button>
      </div>
      <ul className="max-h-40 overflow-auto px-2 pb-2">
        {list.data?.entries.map((entry) => {
          const Icon = entry.kind === 'directory' ? Folder : FileCode2;
          return (
            <li key={entry.path}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => (entry.kind === 'directory' ? setDirectory(entry.path) : openFile(entry.path))}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.size !== undefined && (
                  <span className="shrink-0 text-xs text-muted-foreground">{Math.ceil(entry.size / 1024)} KiB</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <DirectoryFeedback list={list} />
    </section>
  );
}

function DirectoryFeedback({ list }: { list: UseQueryResult<WorkspaceDirectory> }) {
  return (
    <>
      {list.isPending && (
        <p role="status" className="px-3 pb-3 text-xs">
          正在读取目录…
        </p>
      )}
      {list.error && (
        <p role="alert" className="px-3 pb-3 text-xs text-destructive-foreground">
          {list.error.message}
        </p>
      )}
      {list.data?.entries.length === 0 && (
        <p className="px-3 pb-3 text-xs text-muted-foreground">此目录没有同步范围内的文件。</p>
      )}
      {list.data?.truncated && (
        <p className="px-3 pb-3 text-xs text-muted-foreground">
          目录条目较多，仅显示部分内容；可在下方输入相对路径打开文件。
        </p>
      )}
    </>
  );
}
