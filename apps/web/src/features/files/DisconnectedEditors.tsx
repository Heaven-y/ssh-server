import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { buttonClass } from '../../ui/styles';
import { RemoteDialog } from '../remote-files/RemoteDialog';

export function DisconnectedEditors({ workspaceId }: { workspaceId: string }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['disconnected-editors', workspaceId],
    queryFn: ({ signal }) => api.disconnectedEditors(workspaceId, signal),
    refetchInterval: 5000,
  });
  const ids = query.data?.editors ?? [];
  async function forget() {
    setBusy(true);
    setError('');
    try {
      for (const id of ids) await api.forgetFileEditor(workspaceId, id);
      await query.refetch();
      setConfirm(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法清除编辑登记');
    } finally {
      setBusy(false);
    }
  }
  if (!ids.length && !confirm) return null;
  return (
    <>
      <div className="shrink-0 border-t border-border p-3 text-xs">
        <p>有 {ids.length} 个编辑页面已断开。同步文件操作会等待状态确认。</p>
        <button type="button" className={buttonClass('ghost')} onClick={() => setConfirm(true)}>
          处理断开的编辑登记
        </button>
      </div>
      {confirm && (
        <RemoteDialog
          title="放弃断开的编辑登记"
          close={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <div className="space-y-3 p-4 text-sm">
            <p>优先重连原页面，未保存内容仍在原页面中。</p>
            <p>
              确认后将清除本工作区 {ids.length}{' '}
              个已断开页面的保护登记。服务端没有保存这些编辑正文；仅在已另行保留内容或明确放弃修改时继续。
            </p>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <button
              type="button"
              className={buttonClass('outline')}
              disabled={busy || !ids.length}
              onClick={() => void forget()}
            >
              {busy ? '正在处理…' : '确认放弃这些编辑登记'}
            </button>
          </div>
        </RemoteDialog>
      )}
    </>
  );
}
