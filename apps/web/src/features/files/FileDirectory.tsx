import type { WorkspaceDirectory } from '@ssh-server/shared';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { ArrowUp, FolderRoot, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { buttonClass } from '../../ui/styles';
import { LocalDirectoryEntries } from './LocalDirectoryEntries';

export function FileDirectory({
  workspaceId,
  disabled,
  openFile,
  active = true,
}: {
  workspaceId: string;
  disabled: boolean;
  openFile(relative: string): void;
  active?: boolean;
}) {
  const [directory, setDirectory] = useState('');
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ['files', workspaceId, directory],
    queryFn: ({ signal }) => api.listFiles(workspaceId, directory, signal),
    enabled: active,
    retry: false,
    staleTime: 0,
  });
  useEffect(() => {
    if (!active) void client.cancelQueries({ queryKey: ['files', workspaceId, directory], exact: true });
  }, [active, client, workspaceId, directory]);
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
        <button
          type="button"
          className={buttonClass('ghost')}
          aria-label="返回工作区根目录"
          title="返回工作区根目录"
          disabled={disabled || !directory}
          onClick={() => setDirectory('')}
        >
          <FolderRoot aria-hidden className="size-4" />
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={directory || '工作区根目录'}>
          {directory || '工作区根目录'}
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
      <LocalDirectoryEntries
        key={directory}
        entries={list.data?.entries ?? []}
        disabled={disabled || list.isFetching}
        open={(entry) => (entry.kind === 'directory' ? setDirectory(entry.path) : openFile(entry.path))}
      />
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
          目录条目较多，仅显示部分内容；可进入子目录查看，或在服务器文件视图中核对远端实际情况。
        </p>
      )}
    </>
  );
}
