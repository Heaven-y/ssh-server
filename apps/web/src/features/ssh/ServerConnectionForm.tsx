import type { ManagedServer } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { HostKeyConfirmation } from './HostKeyConfirmation';
import { SshPasswordField } from './SshPasswordField';
import { useSshConnection } from './use-ssh-connection';

const PHASES = {
  idle: '尚未连接；私钥或已保存密码可在工作区操作时自动连接',
  connecting: '正在验证服务器认证…',
  verified: '服务器已连接',
  error: 'SSH 操作失败',
  disconnecting: '正在断开 SSH…',
  disconnected: 'SSH 已断开，自动连接已暂停',
  updating: '正在取消保存密码…',
} as const;
function needsPasswordInput(server: ManagedServer, connection: ReturnType<typeof useSshConnection>) {
  return server.authMode === 'password' && !connection.hasPassword && !connection.saved && !connection.reusablePassword;
}
function SavedConnectionHint({
  name,
  requested,
  connected,
}: {
  name: string;
  requested?: boolean;
  connected: boolean;
}) {
  if (!requested || connected) return null;
  return (
    <p role="status" className="rounded border border-accent/40 bg-accent/5 p-3 text-sm leading-6">
      已保存“{name}”。下一步：核对主机指纹后，在下方输入 SSH 密码并连接；密码不写入服务器档案。
    </p>
  );
}
export function ServerConnectionForm({
  server,
  connectAfterSave,
}: {
  server: ManagedServer;
  connectAfterSave?: boolean;
}) {
  const connection = useSshConnection({ sshHost: server.alias, authMode: server.authMode });
  const needsPassword = needsPasswordInput(server, connection);
  return (
    <section aria-label="服务器认证与连接" className="space-y-4">
      <SavedConnectionHint name={server.name} requested={connectAfterSave} connected={connection.verified} />
      <p role={connection.phase === 'error' ? 'alert' : 'status'} className="text-sm leading-6">
        {connection.message ?? PHASES[connection.phase]}
      </p>
      <HostKeyConfirmation
        sshHost={server.alias}
        disabled={connection.busy}
        onChecking={connection.reset}
        onTrusted={connection.reset}
      />
      <form
        aria-label="连接服务器"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void connection.connect();
        }}
      >
        {server.authMode === 'password' ? (
          <SshPasswordField connection={connection} disabled={connection.busy} autoFocus={connectAfterSave} />
        ) : (
          <p className="text-sm text-muted-foreground">使用服务器档案指定的私钥或本机默认私钥。</p>
        )}
        {connection.reusablePassword && (
          <p className="text-xs text-muted-foreground">本机后端已有临时密码，可留空复用；网页不读取密码正文。</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className={buttonClass('primary')}
            disabled={connection.busy || connection.loadingCredentials || needsPassword}
          >
            {connection.busy ? '正在处理…' : '连接服务器'}
          </button>
          <button
            type="button"
            className={buttonClass('danger')}
            disabled={connection.busy || connection.phase === 'disconnected'}
            onClick={() => void connection.disconnect()}
          >
            断开服务器
          </button>
        </div>
      </form>
      <p className="text-xs leading-5 text-muted-foreground">
        连接、重认证、断开或取消密码保存会作用于该服务器的全部工作区。关闭窗口清空当前密码输入，不主动断开已建立的服务器连接。
      </p>
    </section>
  );
}
