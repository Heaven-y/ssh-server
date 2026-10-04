import { useEffect, useId, useRef, useState } from 'react';
import type { HostTrustStatus } from '@ssh-server/shared';
import { api } from '../../lib/api';
import { buttonClass } from '../../ui/styles';

type Props = { sshHost: string; disabled?: boolean; onChecking?(): void; onTrusted?(): void };

function checkHost(sshHost: string, status: HostTrustStatus | undefined, accept: boolean, signal: AbortSignal) {
  if (accept && status?.challenge)
    return api.confirmHostKey(
      { challenge: status.challenge, fingerprint: status.fingerprint, confirmed: true },
      signal,
    );
  return api.probeHostKey(sshHost, signal);
}

function HostKeyCheck({ sshHost, disabled, onChecking, onTrusted }: Props) {
  const id = useId();
  const [status, setStatus] = useState<HostTrustStatus>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const run = async (accept: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = () => !controller.signal.aborted && request.current === controller;
    setBusy(true);
    setError(undefined);
    onChecking?.();
    try {
      const result = await checkHost(sshHost, status, accept, controller.signal);
      if (!current()) return;
      setStatus(result);
      setConfirmed(false);
      if (result.status === 'trusted') onTrusted?.();
    } catch (error) {
      if (!current()) return;
      setStatus(undefined);
      setConfirmed(false);
      setError(error instanceof Error ? error.message : '服务器指纹检查失败');
    } finally {
      if (current()) setBusy(false);
    }
  };
  return (
    <section aria-label="服务器主机指纹" className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">服务器主机指纹</p>
        <button
          type="button"
          className={buttonClass('outline')}
          disabled={disabled || busy || !sshHost}
          onClick={() => void run(false)}
        >
          {busy ? '正在核对…' : '检查实际指纹'}
        </button>
      </div>
      {status && (
        <>
          <p className="text-xs leading-5 text-muted-foreground wrap-anywhere">
            {status.target.username}@{status.target.hostname}:{status.target.port} · {status.algorithm}
          </p>
          <p className="font-mono text-xs leading-5 wrap-anywhere">{status.fingerprint}</p>
          {status.status === 'trusted' ? (
            <p role="status" className="text-xs text-success">
              实际公钥与本机信任记录一致，可以继续测试认证。
            </p>
          ) : (
            <>
              <p className="text-xs leading-5 text-warning">
                首次连接：请通过服务器管理员或其他可信渠道核对上方指纹。确认后将此公钥追加到本机 known_hosts。
              </p>
              <label htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  id={id}
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy || disabled}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                我已核对本次实际指纹
              </label>
              <button
                type="button"
                className={`${buttonClass('primary')} self-start`}
                disabled={!confirmed || busy || disabled}
                onClick={() => void run(true)}
              >
                信任此公钥
              </button>
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-xs leading-5 text-destructive-foreground">
          {error}
        </p>
      )}
    </section>
  );
}

/** 切换目标销毁旧挑战与在途握手；组件不持有或重发认证凭据。 */
export function HostKeyConfirmation(props: Props) {
  return <HostKeyCheck key={props.sshHost} {...props} />;
}
