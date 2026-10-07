import { useQuery } from '@tanstack/react-query';
import { Server } from 'lucide-react';
import { useState } from 'react';
import type { Workspace } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { buttonClass } from '../../ui/styles';
import { DetailDialog } from '../../ui/DetailDialog';
import { ServerManagerDialog } from './ServerManagerDialog';

/** 工作区只展示服务器共享状态，认证操作统一交给服务器管理。 */
export function SshConnectionPanel({ workspace }: { workspace: Workspace }) {
  const [opened, setOpened] = useState<'details' | 'manager'>();
  const credentials = useQuery({
    queryKey: queryKeys.sshCredentials(workspace.sshHost),
    queryFn: ({ signal }) => api.sshCredentials(workspace.sshHost, signal),
    retry: false,
    refetchInterval: 10000,
  });
  const status = credentials.data;
  const label = credentials.isError
    ? '状态不可用'
    : status?.connected
      ? '已连接'
      : status?.paused
        ? '已断开，自动连接暂停'
        : '尚未连接';
  return (
    <>
      <button
        type="button"
        className={`${buttonClass('ghost')} max-w-[min(320px,40vw)] px-2`}
        aria-label="SSH 连接详情"
        aria-expanded={!!opened}
        onClick={() => setOpened('details')}
      >
        <Server aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate text-xs">{workspace.sshHost}</span>
        <span className="shrink-0 text-xs">· {label}</span>
      </button>
      {opened === 'details' && (
        <DetailDialog title="SSH 连接" onClose={() => setOpened(undefined)}>
          <div className="space-y-4 text-sm">
            <p role="status">{label}（服务器共享状态）</p>
            <p className="wrap-anywhere">远端目录：{workspace.remoteDir}</p>
            <p>认证方式、密码保存与断开操作在服务器中统一管理，会影响引用该服务器的所有工作区。</p>
            <button type="button" className={buttonClass('primary')} onClick={() => setOpened('manager')}>
              管理服务器
            </button>
          </div>
        </DetailDialog>
      )}
      {opened === 'manager' && (
        <ServerManagerDialog initialAlias={workspace.sshHost} onClose={() => setOpened(undefined)} />
      )}
    </>
  );
}
