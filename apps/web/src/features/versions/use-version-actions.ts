import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SyncStatus, VersionRestorePreview, VersionStatus } from '@ssh-server/shared';
import { api, ApiError, queryKeys } from '../../lib/api';

export type VersionNotice = { tone: 'success' | 'warning' | 'error'; text: string };
const errorText = (error: unknown) => (error instanceof Error ? error.message : '版本操作失败，请重新尝试');
function syncNotice(status: SyncStatus): VersionNotice {
  if (status.phase === 'ready' && !status.reason && !status.conflicts.length && !status.deletions.length)
    return { tone: 'success', text: '本地恢复已完成，后续同步也已完成。' };
  if (status.phase === 'error') return { tone: 'error', text: '本地恢复已完成，但同步失败。请打开文件同步详情处理。' };
  if (status.reason === 'deletions' || status.deletions.length > 0)
    return { tone: 'warning', text: '本地恢复已完成，删除尚未传播到服务器。请在文件同步详情中确认或拒绝删除。' };
  if (status.phase === 'conflicts' || status.conflicts.length > 0)
    return { tone: 'warning', text: '本地恢复已完成，同步发现文件冲突。请在文件同步详情中处理。' };
  return { tone: 'warning', text: '本地恢复已完成，同步尚未就绪。请查看文件同步详情中的状态或确认项。' };
}

export function useVersionActions(id: string, setBusy: (busy: boolean) => void) {
  const client = useQueryClient();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState<string>();
  const [affectedPaths, setAffectedPaths] = useState<string[]>([]);
  const [notice, setNotice] = useState<VersionNotice>();
  const [syncResult, setSyncResult] = useState<VersionNotice>();
  const [preview, setPreview] = useState<VersionRestorePreview>();
  const [previewStatusRevision, setPreviewStatusRevision] = useState<string>();
  const [previewVersion, setPreviewVersion] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function perform(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    setAffectedPaths([]);
    setNotice(undefined);
    setSyncResult(undefined);
    try {
      await client.cancelQueries({ queryKey: queryKeys.versions(id), exact: true });
      await action();
    } catch (failure) {
      if (mounted.current) {
        setError(errorText(failure));
        if (failure instanceof ApiError) setAffectedPaths(failure.affectedPaths ?? []);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function updateStatus(status: VersionStatus) {
    client.setQueryData(queryKeys.versions(id), status);
  }
  async function synchronize() {
    try {
      const status = await api.syncWorkspace(id);
      client.setQueryData(queryKeys.sync(id), status);
      if (mounted.current) setSyncResult(syncNotice(status));
    } catch (failure) {
      void client.invalidateQueries({ queryKey: queryKeys.sync(id), exact: true });
      if (mounted.current)
        setSyncResult({
          tone: 'error',
          text: `本地恢复已完成，自动同步失败：${errorText(failure)}。请在文件同步详情中处理。`,
        });
    }
  }
  return {
    error,
    affectedPaths,
    notice,
    syncResult,
    preview,
    previewStatusRevision,
    previewVersion,
    clearPreview: () => setPreview(undefined),
    save(message: string, revision: string) {
      return perform(async () => {
        const result = await api.saveVersion(id, { message, revision });
        updateStatus(result.status);
        void client.invalidateQueries({ queryKey: [...queryKeys.versions(id), 'history'] });
        if (!mounted.current) return;
        setPreview(undefined);
        setNotice({
          tone: 'success',
          text: result.created
            ? `已保存本地版本${result.commit ? ` ${result.commit.id.slice(0, 8)}` : ''}。`
            : '没有需要记录的改动，未创建空版本。',
        });
      });
    },
    prepare(commit: string, path?: string) {
      return perform(async () => {
        // 状态摘要与恢复令牌的作用域不同；界面只比较同类状态摘要。
        const status = await api.versionStatus(id);
        updateStatus(status);
        const result = await api.previewVersionRestore(id, { commit, path });
        if (mounted.current) {
          setPreviewStatusRevision(status.revision);
          setPreview(result);
          setPreviewVersion((current) => current + 1);
        }
      });
    },
    restore() {
      if (!preview) return Promise.resolve();
      const confirmed = preview;
      return perform(async () => {
        const result = await api.restoreVersion(id, {
          commit: confirmed.commit,
          path: confirmed.path,
          revision: confirmed.revision,
        });
        updateStatus(result.status);
        if (mounted.current) {
          setPreview(undefined);
          setNotice({
            tone: 'success',
            text: `已恢复 ${result.restored.length} 个本地文件。历史记录与未保存的编辑器内容保持原样。`,
          });
        }
        await synchronize();
      });
    },
  };
}
