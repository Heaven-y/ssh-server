import { useId } from 'react';
import { SyncSettingsSchema, type WorkspaceInput, type WorkspaceSetupVerification } from '@ssh-server/shared';
import { buttonClass } from '../../../ui/styles';

function VerifiedDirectories({ ticket }: { ticket: WorkspaceSetupVerification }) {
  return (
    <div role="status" className="rounded border border-border p-3 text-xs leading-5">
      <p>验证通过：目录与连接可用；修改配置后需重新验证。</p>
      <p>
        本地：{ticket.local.empty ? '空目录' : '非空目录'}
        {ticket.local.git ? '，已有 .git' : ''}
      </p>
      <p>
        远端：{ticket.remote.empty ? '空目录' : '非空目录'}
        {ticket.remote.git ? '，已有 .git' : ''}
      </p>
    </div>
  );
}

export function ConfirmStep(props: {
  input: WorkspaceInput;
  ticket?: WorkspaceSetupVerification;
  busy: boolean;
  creating: boolean;
  confirmed: boolean;
  setConfirmed(value: boolean): void;
  verify(): void;
}) {
  const id = useId();
  const settings = SyncSettingsSchema.parse(props.input.sync ?? {});
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid min-w-0 grid-cols-[80px_minmax(0,1fr)] gap-3 text-xs leading-5">
        <dt className="text-muted-foreground">名称</dt>
        <dd className="wrap-anywhere">{props.input.name}</dd>
        <dt className="text-muted-foreground">本地副本</dt>
        <dd className="font-mono wrap-anywhere">{props.ticket?.local.path ?? props.input.localDir}</dd>
        <dt className="text-muted-foreground">服务器</dt>
        <dd className="wrap-anywhere">{props.input.sshHost} · 使用服务器档案认证</dd>
        <dt className="text-muted-foreground">远端目录</dt>
        <dd className="font-mono wrap-anywhere">{props.ticket?.remote.path ?? props.input.remoteDir}</dd>
        <dt className="text-muted-foreground">同步规则</dt>
        <dd className="wrap-anywhere">
          单文件 {(settings.maxFileBytes / 1024 / 1024).toFixed(2)} MiB，排除{' '}
          {settings.excludedExtensions.join(', ') || '无扩展名限制'}
        </dd>
      </dl>
      <p className="rounded border border-warning/40 bg-warning/5 p-3 text-xs leading-5">
        首次同步将合并两端文件。同名不同内容会保留冲突副本，需要处理后再继续。创建后若同步失败，工作区和已发生的文件变化会保留，可从同步详情检查与恢复。
      </p>
      <button
        type="button"
        className={`${buttonClass('outline')} self-start`}
        disabled={props.busy || props.creating}
        onClick={props.verify}
      >
        {props.busy ? '正在验证目录与认证…' : '验证当前配置'}
      </button>
      {props.ticket && (
        <>
          <VerifiedDirectories ticket={props.ticket} />
          <label htmlFor={id} className="flex min-h-11 items-start gap-2 text-sm leading-6">
            <input
              id={id}
              type="checkbox"
              className="mt-1.5"
              checked={props.confirmed}
              disabled={props.creating}
              onChange={(event) => props.setConfirmed(event.target.checked)}
            />
            我已核对两端目录，确认创建并初始化同步
          </label>
        </>
      )}
    </div>
  );
}
