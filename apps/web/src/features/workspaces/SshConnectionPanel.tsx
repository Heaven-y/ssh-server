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
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type RefCallback } from 'react';
import { WorkspaceInputSchema, type SshAuthMode, type Workspace } from '@ssh-server/shared';
import { api, ApiError, type SshConnectionTarget } from '../../lib/api';
import { buttonClass, inputClass } from '../../ui/styles';

type Phase = 'idle' | 'connecting' | 'verified' | 'error' | 'disconnecting' | 'disconnected';
type ConnectionState = { targetId: string; phase: Phase; message?: string };
type Connection = ReturnType<typeof useSshConnection>;

const TARGET_SCHEMA = WorkspaceInputSchema.pick({ sshHost: true, remoteDir: true, authMode: true });
const PHASES = {
  idle: { label: '本页尚未验证 SSH 连接', icon: PlugZap, cls: 'text-muted-foreground' },
  connecting: { label: '正在验证 SSH 认证与目录…', icon: LoaderCircle, cls: 'text-muted-foreground' },
  verified: { label: 'SSH 认证与目录验证成功', icon: CheckCircle2, cls: 'text-accent' },
  error: { label: 'SSH 操作失败', icon: CircleAlert, cls: 'text-destructive-foreground' },
  disconnecting: { label: '正在断开 SSH 连接…', icon: LoaderCircle, cls: 'text-muted-foreground' },
  disconnected: { label: 'SSH 已断开，内存凭据已清除', icon: Unplug, cls: 'text-muted-foreground' },
} as const;

const SSH_ERRORS: Record<string, string> = {
  host_key_unknown: '尚未登记服务器主机密钥。请先在本机终端用 ssh 核对该 Host 的指纹，再重试。',
  host_key_mismatch: '服务器主机密钥与 known_hosts 不一致，已拒绝连接。请核实密钥变化原因后再重试。',
  host_key_revoked: '服务器主机密钥已吊销，已拒绝连接。请联系服务器管理员核实。',
  unsupported_config: '该 Host 未配置或包含暂不支持的 SSH 选项。请检查本机 ~/.ssh/config。',
  connection_failed: '无法连接 SSH 服务器。请检查网络、Host 配置和服务器是否可用，再重试。',
  connection_cancelled: 'SSH 连接已失效，请重新验证连接。',
  remote_directory_unavailable: '无法进入服务器目录。请检查目录是否存在以及账号的访问权限。',
  directory_unavailable: '无法进入服务器目录。请检查目录是否存在以及账号的访问权限。',
  protocol_error: '连接接口返回了无效状态，请重新测试连接。',
};
const HTTP_SSH_ERRORS: Record<number, string> = {
  400: '连接参数无效。请检查 Host、认证方式及服务器目录。',
  409: 'SSH 认证或主机密钥校验失败。请核对凭据与 known_hosts 后重试。',
  502: 'SSH 连接或目录检查失败。请检查网络、Host 及服务器目录的访问权限。',
};

function sshErrorMessage(error: unknown, authMode: SshAuthMode): string {
  if (!(error instanceof ApiError)) return '无法访问本地后端，请检查后端是否运行，再重试连接。';
  if (error.status === 401) return error.message;
  if (['authentication_failed', 'credentials_required'].includes(error.code ?? '')) {
    return authMode === 'password'
      ? 'SSH 密码未提供、已失效或认证失败。请重新输入密码后连接。'
      : 'SSH 私钥未找到或认证失败。请检查本机私钥与 Host 配置。';
  }
  return (
    SSH_ERRORS[error.code ?? ''] ?? HTTP_SSH_ERRORS[error.status] ?? `SSH 请求失败（${error.status}），请稍后重试。`
  );
}

/** 只校验连接目标；测试连接不要求先填写工作区名称与本地目录。 */
export function sshTargetErrors(target: SshConnectionTarget): Partial<Record<'sshHost' | 'remoteDir', string>> {
  const result = TARGET_SCHEMA.safeParse(target);
  if (result.success) return {};
  const errors: Partial<Record<'sshHost' | 'remoteDir', string>> = {};
  for (const issue of result.error.issues) {
    if (issue.path[0] === 'sshHost') errors.sshHost = '请选择服务器 Host';
    if (issue.path[0] === 'remoteDir') errors.remoteDir ??= issue.message;
  }
  return errors;
}

/** 认证请求独立执行；React 状态仅保存是否有输入和验证结果，不保存密码文本。 */
export function useSshConnection(target: SshConnectionTarget) {
  const { sshHost, remoteDir, authMode } = target;
  const targetId = JSON.stringify([sshHost, authMode, remoteDir]);
  const [state, setState] = useState<ConnectionState>({ targetId, phase: 'idle' });
  const [hasPassword, setHasPassword] = useState(false);
  const passwordInput = useRef<HTMLInputElement | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const current = state.targetId === targetId ? state : { targetId, phase: 'idle' as const };
  const busy = current.phase === 'connecting' || current.phase === 'disconnecting';

  const clearPassword = useCallback(() => {
    if (passwordInput.current) passwordInput.current.value = '';
    setHasPassword(false);
  }, []);

  // React 19 的 ref 清理在输入框卸载时执行，切换方式、收起面板和销毁组件都会抹除文本。
  const passwordRef = useCallback((node: HTMLInputElement | null) => {
    passwordInput.current = node;
    if (!node) return;
    return () => {
      node.value = '';
      if (passwordInput.current === node) passwordInput.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [targetId]);

  const reset = () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    clearPassword();
    setState({ targetId, phase: 'idle' });
  };

  const passwordChanged = () => {
    setHasPassword(Boolean(passwordInput.current?.value));
    setState({ targetId, phase: 'idle' });
  };

  const runRequest = async (
    request: (signal: AbortSignal) => Promise<unknown>,
    phase: 'connecting' | 'disconnecting',
    success: 'verified' | 'disconnected',
  ) => {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setState({ targetId, phase });
    try {
      const pending = request(controller.signal);
      // 同步抹除 DOM 中的密码，完成清理后才等待结果或触发上层操作。
      clearPassword();
      await pending;
      if (!controller.signal.aborted) setState({ targetId, phase: success });
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({ targetId, phase: 'error', message: sshErrorMessage(error, authMode) });
      }
    } finally {
      // 旧请求结束时不能清除新目标上新输入的密码。
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        clearPassword();
      }
    }
  };

  const connect = async () => {
    const errors = sshTargetErrors(target);
    const message = errors.sshHost ?? errors.remoteDir;
    if (message) {
      setState({ targetId, phase: 'error', message });
      return;
    }
    if (authMode === 'password' && !passwordInput.current?.value) {
      setState({ targetId, phase: 'error', message: '请先输入 SSH 密码，再测试连接。' });
      passwordInput.current?.focus();
      return;
    }
    await runRequest(
      (signal) =>
        api
          .connectSsh(
            authMode === 'password'
              ? { sshHost, remoteDir, authMode, password: passwordInput.current?.value }
              : { sshHost, remoteDir, authMode },
            signal,
          )
          .then((result) => {
            if (result.connected !== true || result.authMode !== authMode) {
              throw new ApiError(502, '连接接口返回了无效状态', undefined, 'protocol_error');
            }
          }),
      'connecting',
      'verified',
    );
  };

  const disconnect = () => runRequest((signal) => api.disconnectSsh(sshHost, signal), 'disconnecting', 'disconnected');

  return {
    phase: current.phase,
    message: current.message,
    busy,
    verified: current.phase === 'verified',
    hasPassword,
    passwordRef,
    passwordChanged,
    clearPassword,
    focusPassword: () => passwordInput.current?.focus(),
    reset,
    connect,
    disconnect,
  };
}

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

export function SshPasswordField({
  inputRef,
  onChange,
  disabled = false,
  autoFocus = false,
}: {
  inputRef: RefCallback<HTMLInputElement>;
  onChange(): void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        SSH 密码（仅当前连接）
      </label>
      <input
        id={id}
        ref={inputRef}
        type="password"
        autoComplete="current-password"
        autoFocus={autoFocus}
        aria-describedby={`${id}-hint`}
        className={inputClass}
        disabled={disabled}
        onChange={onChange}
      />
      <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
        发送后立即清空。断开连接或后端重启后，需要重新输入。
      </p>
    </div>
  );
}

function actionLabel(authMode: SshAuthMode, verified: boolean) {
  if (authMode === 'key') return verified ? '重新测试连接' : '连接并测试';
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
          <SshPasswordField
            inputRef={connection.passwordRef}
            onChange={connection.passwordChanged}
            disabled={connection.busy}
            autoFocus
          />
          <button
            type="submit"
            className={`${buttonClass('primary')} self-start active:bg-accent/80`}
            disabled={connection.busy || !connection.hasPassword}
          >
            {connection.busy ? '正在验证…' : '验证密码并连接'}
          </button>
        </form>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">使用本机 SSH 配置中的私钥，连接时同时检查服务器目录。</p>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        验证结果仅表示本页最近一次测试。断开会关闭该 Host 的连接并清除其内存密码。
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
    if (authMode === 'key') {
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
            {actionLabel(authMode, connection.verified)}
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
