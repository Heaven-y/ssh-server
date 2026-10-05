import { useEffect, useRef, useState } from 'react';
import type { SyncStatus, VersionDiscardPreview } from '@ssh-server/shared';
import { api, ApiError, queryKeys } from '../../lib/api';
import { queryClient } from '../../lib/query-client';

function syncMessage(status: SyncStatus): string {
  if (status.phase === 'ready' && !status.reason) return '本地放弃完成，服务器同步完成。';
  if (status.deletions.length || status.reason === 'deletions')
    return '本地放弃完成；服务器删除尚待在同步详情中确认或拒绝。';
  if (status.conflicts.length) return '本地放弃完成；同步存在冲突，请查看同步详情。';
  return '本地放弃完成；服务器同步尚未就绪，请查看同步详情。';
}

export function useDiscard(workspaceId: string) {
  const mounted = useRef(true);
  const flight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<VersionDiscardPreview>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function perform(operation: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (failure) {
      if (mounted.current) {
        setError(failure instanceof Error ? failure.message : '放弃操作失败，请重新读取预览');
        if (failure instanceof ApiError && failure.code === 'stale_revision') setPreview(undefined);
      }
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function synchronize() {
    try {
      const status = await api.syncWorkspace(workspaceId);
      queryClient.setQueryData(queryKeys.sync(workspaceId), status);
      if (mounted.current) setNotice(syncMessage(status));
    } catch {
      if (mounted.current) setNotice('本地放弃完成；服务器同步失败，请在同步详情中处理。');
      void queryClient.invalidateQueries({ queryKey: queryKeys.sync(workspaceId) });
    }
  }
  return {
    busy,
    preview,
    error,
    notice,
    cancel: () => setPreview(undefined),
    prepare(path: string) {
      return perform(async () => {
        setPreview(undefined);
        const value = await api.previewDiscard(workspaceId, path);
        if (mounted.current) setPreview(value);
      });
    },
    discard() {
      if (!preview) return Promise.resolve();
      const confirmed = preview;
      return perform(async () => {
        const result = await api.discardFile(workspaceId, {
          path: confirmed.path,
          revision: confirmed.revision,
          confirmed: true,
        });
        queryClient.setQueriesData({ queryKey: queryKeys.versions(workspaceId) }, result.status);
        if (mounted.current) {
          setPreview(undefined);
          setNotice(`已放弃${result.restored.length}个本地文件；编辑器未保存内容保留。`);
        }
        await synchronize();
        void queryClient.invalidateQueries({ queryKey: ['working-diff', workspaceId] });
      });
    },
  };
}
