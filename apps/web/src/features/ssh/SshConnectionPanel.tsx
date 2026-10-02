import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  KeyRound,
  LoaderCircle,
  PlugZap,
  Unplug,
} from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import type { SshAuthMode, Workspace } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { useSshConnection } from './use-ssh-connection';
import { SshPasswordField } from './SshPasswordField';

type Connection = ReturnType<typeof useSshConnection>;

const PHASES = {
  idle: { label: '本页尚未验证 SSH 连接', icon: PlugZap, cls: 'text-muted-foreground' },
  connecting: { label: '正在验证 SSH 认证与目录…', icon: LoaderCircle, cls: 'text-muted-foreground' },
  verified: { label: 'SSH 认证与目录验证成功', icon: CheckCircle2, cls: 'text-accent' },
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

/** 当前工作区的内联入口；这里只显示本页操作结果，不把网页连接视为 SSH 已连接。 */
export function SshConnectionPanel({ workspace }: { workspace: Workspace }) {
  const authMode = workspace.authMode ?? 'key';
  const connection = useSshConnection({ sshHost: workspace.sshHost, remoteDir: workspace.remoteDir, authMode });
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const start = () => {
    if (authMode === 'key' || connection.saved) {
      void connection.connect();
    } else {
      setExpanded(true);
      connection.focusPassword();
    }
  };
  const toggle = () => {
    connection.clearPassword();
    setExpanded((value) => !value);
  };
  const ToggleIcon = expanded ? ChevronUp : ChevronDown;

  return (
    <section aria-labelledby={`${id}-heading`} className="shrink-0 border-b border-border bg-card px-4 py-3">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={`${id}-heading`} className="flex items-center gap-2 text-sm font-medium">
              <KeyRound aria-hidden className="size-4" />
              SSH 连接
            </h2>
            <span className="text-xs text-muted-foreground">{authMode === 'key' ? '已有私钥' : '账号密码'}</span>
            <span className="min-w-0 font-mono text-xs text-muted-foreground wrap-anywhere">{workspace.sshHost}</span>
          </div>
          <SshConnectionFeedback connection={connection} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`${buttonClass('outline')} active:bg-muted`}
            onClick={start}
            disabled={connection.busy}
          >
            <PlugZap aria-hidden className="size-4" />
            {actionLabel(authMode, connection.verified, connection.saved)}
          </button>
          <button
            type="button"
            className={`${buttonClass('danger')} active:bg-destructive/15`}
            disabled={connection.busy || connection.phase === 'disconnected'}
            onClick={() => void connection.disconnect()}
          >
            <Unplug aria-hidden className="size-4" />
            断开 SSH
          </button>
          <button
            type="button"
            className={`${buttonClass('ghost')} active:bg-muted`}
            aria-label={expanded ? '收起 SSH 连接详情' : '展开 SSH 连接详情'}
            aria-expanded={expanded}
            aria-controls={`${id}-details`}
            disabled={connection.busy}
            onClick={toggle}
          >
            <ToggleIcon aria-hidden className="size-4" />
            {expanded ? '收起' : '详情'}
          </button>
        </div>
      </div>
      {expanded && (
        <div id={`${id}-details`} className="mt-3 flex min-w-0 flex-col gap-3 border-t border-border pt-3">
          <SshConnectionDetails workspace={workspace} connection={connection} />
        </div>
      )}
    </section>
  );
}
