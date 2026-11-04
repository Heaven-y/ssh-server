import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Unlink } from 'lucide-react';
import type { Workspace } from '@agentdeck/shared';
import { api, queryKeys } from '../lib/api';
import { DetailDialog } from '../ui/DetailDialog';
import { buttonClass, inputClass } from '../ui/styles';

/**
 * 绑定服务器：选一台已登记的服务器 + 一个默认浏览目录。
 *
 * 两者必须同时给出或同时清除——后端把这条规则叫「同进同退」：只绑服务器不给目录的项目
 * 打不开任何服务器面板，却仍占着「服务器被引用」的名额，属纯负面状态。
 * 所以这里要么提交成对的值，要么整体解绑，不提供「只改一半」的入口。
 */
export function BindServerDialog({ project, onClose }: { project: Workspace; onClose(): void }) {
  const client = useQueryClient();
  const ids = useId();
  const servers = useQuery({ queryKey: queryKeys.sshHosts, queryFn: ({ signal }) => api.listSshHosts(signal) });
  const [alias, setAlias] = useState(project.server ?? '');
  const [remoteDir, setRemoteDir] = useState(project.remoteDir ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bound = project.server !== undefined && project.remoteDir !== undefined;

  const run = async (patch: Parameters<typeof api.updateProject>[1]) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.updateProject(project.id, patch);
      await client.invalidateQueries({ queryKey: queryKeys.workspaces });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const unbind = () => run({ server: null, remoteDir: null });

  return (
    <DetailDialog title={bound ? '服务器绑定' : '绑定服务器'} busy={busy} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run({ server: alias || null, remoteDir: remoteDir.trim() || null });
        }}
      >
        <p className="text-xs leading-5 text-muted-foreground">
          绑定只决定服务器面板的默认目标与打开终端时进入的目录，不会改动项目目录，也不会动服务器上的文件。
        </p>
        <div className="space-y-2">
          <label htmlFor={`${ids}-server`} className="block text-sm font-medium">
            服务器
          </label>
          <select
            id={`${ids}-server`}
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            className={inputClass}
            disabled={servers.isLoading}
          >
            <option value="">不绑定</option>
            {(servers.data ?? []).map((server) => (
              <option key={server.alias} value={server.alias}>
                {server.name}（{server.username}@{server.hostname}）
              </option>
            ))}
          </select>
          {servers.isSuccess && servers.data.length === 0 && (
            <p className="text-xs text-muted-foreground">还没有登记服务器。先在顶栏的服务器管理里添加一台。</p>
          )}
        </div>
        <div className="space-y-2">
          <label htmlFor={`${ids}-dir`} className="block text-sm font-medium">
            服务器上的默认目录
          </label>
          <input
            id={`${ids}-dir`}
            value={remoteDir}
            onChange={(event) => setRemoteDir(event.target.value)}
            placeholder="~/projects/demo"
            className={`${inputClass} font-mono text-xs`}
          />
          <p className="text-xs text-muted-foreground">
            以 / 或 ~ 开头。绑定服务器时必填；不绑定时会连同服务器一起清除。
          </p>
        </div>
        {/* 半绑定态在界面上根本不该出现，一旦出现就说明配置被人手改过，直接说清楚。 */}
        <HalfBound project={project} />
        {error && (
          <p role="alert" className="text-sm leading-6 text-destructive-foreground">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          {bound && (
            <button type="button" className={buttonClass('ghost')} disabled={busy} onClick={() => void unbind()}>
              <Unlink aria-hidden className="size-4" />
              解绑
            </button>
          )}
          <button type="button" className={buttonClass('ghost')} disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="submit" className={buttonClass('primary')} disabled={busy}>
            <Link2 aria-hidden className="size-4" />
            保存
          </button>
        </div>
      </form>
    </DetailDialog>
  );
}

function HalfBound({ project }: { project: Workspace }) {
  const only = project.server !== undefined ? 'server' : project.remoteDir !== undefined ? 'remoteDir' : undefined;
  if (!only) return null;
  return (
    <p role="alert" className="text-sm leading-6 text-destructive-foreground">
      当前配置只有 {only}、缺少另一半，属无效状态（可能被手工改过）。请补齐两项，或选择「不绑定」后保存。
    </p>
  );
}
