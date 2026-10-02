import { CheckCircle2, CircleAlert, Server, LoaderCircle, PlugZap, Unplug } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { SshAuthMode, Workspace } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { DetailDialog } from '../../ui/DetailDialog';
import { useSshConnection } from './use-ssh-connection';
import { SshPasswordField } from './SshPasswordField';

type Connection = ReturnType<typeof useSshConnection>;

const PHASES = {
  idle: { label: '本页尚未验证 SSH 连接', icon: PlugZap, cls: 'text-muted-foreground' },
  connecting: { label: '正在验证 SSH 认证与目录…', icon: LoaderCircle, cls: 'text-muted-foreground' },
  verified: { label: 'SSH 认证与目录验证成功', icon: CheckCircle2, cls: 'text-success' },
  error: { label: 'SSH 操作失败', icon: CircleAlert, cls: 'text-destructive-foreground' },
  disconnecting: { label: '正在断开 SSH 连接…', icon: LoaderCircle, cls: 'text-muted-foreground' },
  disconnected: { label: 'SSH 已断开，自动连接已暂停', icon: Unplug, cls: 'text-muted-foreground' },
  updating: { label: '正在取消保存密码…', icon: LoaderCircle, cls: 'text-muted-foreground' },
} as const;

export function SshConnectionFeedback({ connection }: { connection: Connection }) {
  const status = PHASES[connection.phase];
  const Icon = status.icon;
  return (
    <div
      role={connection.phase === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
      className={`flex min-w-0 items-start gap-2 text-xs leading-5 ${status.cls}`}
    >
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${connection.busy ? 'motion-safe:animate-pulse' : ''}`} />
      <span className="min-w-0 wrap-break-word">{connection.message ?? status.label}</span>
    </div>
  );
}

function actionLabel(authMode: SshAuthMode, verified: boolean, saved: boolean) {
  if (authMode === 'key') return verified ? '重新测试连接' : '连接并测试';
  if (saved) return verified ? '重新测试连接' : '使用已保存密码连接';
  return verified ? '重新认证' : '输入密码连接';
}

function SshConnectionDetails({ workspace, connection }: { workspace: Workspace; connection: Connection }) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void connection.connect();
  };
  return (
    <>
      <p className="text-xs leading-5 text-muted-foreground">
        服务器目录：<span className="font-mono text-foreground wrap-anywhere">{workspace.remoteDir}</span>
      </p>
      {workspace.authMode === 'password' ? (
        <form aria-label="重新认证 SSH" onSubmit={submit} className="flex max-w-lg flex-col gap-3">
          <SshPasswordField connection={connection} disabled={connection.busy} autoFocus />
          <button
            type="submit"
            className={`${buttonClass('primary')} self-start active:bg-accent/80`}
            disabled={connection.busy || (!connection.hasPassword && !connection.saved)}
          >
            {connection.busy ? '正在验证…' : '验证密码并连接'}
          </button>
        </form>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">使用本机 SSH 配置中的私钥，连接时同时检查服务器目录。</p>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        验证结果仅表示本页最近一次测试。断开后暂停自动连接，已保存密码会保留。
      </p>
    </>
  );
}

const BRIEF = {
  idle: '待验证',
  connecting: '连接中',
  verified: '已验证',
  error: '连接失败',
  disconnecting: '断开中',
  disconnected: '已断开',
  updating: '更新中',
} as const;

/** 摘要始终挂载；详情按需展开，不把本机网页连接状态当作 SSH 状态。 */
export function SshConnectionPanel({ workspace }: { workspace: Workspace }) {
  const authMode = workspace.authMode ?? 'key';
  const connection = useSshConnection({ sshHost: workspace.sshHost, remoteDir: workspace.remoteDir, authMode });
  const [expanded, setExpanded] = useState(false);
  const close = () => {
    connection.clearPassword();
    setExpanded(false);
  };
  const status = PHASES[connection.phase];
  const unavailable = connection.phase === 'idle' && Boolean(connection.message);
  return (
    <>
      <button
        type="button"
        className={`${buttonClass('ghost')} max-w-[min(320px,40vw)] px-2`}
        aria-label="SSH 连接详情"
        aria-expanded={expanded}
        title={connection.message ?? status.label}
        onClick={() => setExpanded(true)}
      >
        <Server aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate text-xs">{workspace.sshHost}</span>
        <span className={`shrink-0 text-xs ${unavailable ? 'text-warning' : status.cls}`}>
          · {unavailable ? '状态不可用' : BRIEF[connection.phase]}
        </span>
      </button>
      {expanded && (
        <DetailDialog title="SSH 连接" busy={connection.busy} onClose={close}>
          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-2 text-sm font-medium">
                {workspace.sshHost}
                <span className="ml-2 font-normal text-muted-foreground">
                  {authMode === 'key' ? '已有私钥' : '账号密码'}
                </span>
              </p>
              <SshConnectionFeedback connection={connection} />
            </div>
            <SshConnectionDetails workspace={workspace} connection={connection} />
            <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
              <button
                type="button"
                className={buttonClass('danger')}
                disabled={connection.busy || connection.phase === 'disconnected'}
                onClick={() => void connection.disconnect()}
              >
                <Unplug aria-hidden className="size-4" />
                断开 SSH
              </button>
              {authMode === 'key' && (
                <button
                  type="button"
                  className={buttonClass('primary')}
                  disabled={connection.busy}
                  onClick={() => void connection.connect()}
                >
                  <PlugZap aria-hidden className="size-4" />
                  {actionLabel(authMode, connection.verified, connection.saved)}
                </button>
              )}
            </div>
          </div>
        </DetailDialog>
      )}
    </>
  );
}
