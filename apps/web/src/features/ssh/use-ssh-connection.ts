import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WorkspaceInputSchema, type SshAuthMode } from '@ssh-server/shared';
import { api, ApiError, queryKeys, type SshConnectionTarget, type SshCredentialStatus } from '../../lib/api';

type Phase = 'idle' | 'connecting' | 'verified' | 'error' | 'disconnecting' | 'disconnected' | 'updating';
type ConnectionState = { targetId: string; phase: Phase; message?: string };

const TARGET_SCHEMA = WorkspaceInputSchema.pick({ sshHost: true, remoteDir: true, authMode: true });
const SSH_ERRORS: Record<string, string> = {
  host_key_unknown: '尚未登记服务器主机密钥。请先在本机终端用 ssh 核对该 Host 的指纹，再重试。',
  host_key_mismatch: '服务器主机密钥与 known_hosts 不一致，已拒绝连接。请核实密钥变化原因后再重试。',
  host_key_revoked: '服务器主机密钥已吊销，已拒绝连接。请联系服务器管理员核实。',
  unsupported_config: '该 Host 未配置或包含暂不支持的 SSH 选项。请检查本机 ~/.ssh/config。',
  connection_failed: '无法连接 SSH 服务器。请检查网络、Host 配置和服务器是否可用，再重试。',
  connection_cancelled: 'SSH 连接已失效，请重新验证连接。',
  connection_paused: 'SSH 已主动断开，点击连接后恢复。',
  password_storage_unavailable: '当前系统不支持加密保存密码，可取消保存后使用临时密码连接。',
  credential_storage_failed: '本机加密凭据操作失败，请检查配置目录权限或取消保存后重试。',
  credential_operation_cancelled: '凭据操作已取消，请重新连接。',
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

function feedbackState(current: ConnectionState, paused: boolean, error: unknown, authMode: SshAuthMode) {
  return {
    phase: current.phase === 'idle' && paused ? ('disconnected' as const) : current.phase,
    message: current.message ?? (error && current.phase === 'idle' ? sshErrorMessage(error, authMode) : undefined),
  };
}

/** 认证请求独立执行；React 状态仅保存是否有输入和验证结果，不保存密码文本。 */
export function useSshConnection(target: SshConnectionTarget) {
  const { sshHost, remoteDir, authMode } = target;
  const targetId = JSON.stringify([sshHost, authMode, remoteDir]);
  const queryClient = useQueryClient();
  const credentials = useQuery({
    queryKey: queryKeys.sshCredentials(sshHost),
    queryFn: ({ signal }) => api.sshCredentials(sshHost, signal),
    enabled: Boolean(sshHost),
    retry: false,
    staleTime: 0,
  });
  const [preference, setPreference] = useState<{ targetId: string; save: boolean }>();
  const savePassword = preference?.targetId === targetId ? preference.save : (credentials.data?.saved ?? false);
  const [state, setState] = useState<ConnectionState>({ targetId, phase: 'idle' });
  const [hasPassword, setHasPassword] = useState(false);
  const passwordInput = useRef<HTMLInputElement | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const current = state.targetId === targetId ? state : { targetId, phase: 'idle' as const };
  const busy = ['connecting', 'disconnecting', 'updating'].includes(current.phase);
  const saved = credentials.data?.saved === true;

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
    request: (signal: AbortSignal) => Promise<SshCredentialStatus | void>,
    phase: 'connecting' | 'disconnecting' | 'updating',
    success: 'verified' | 'disconnected',
  ) => {
    if (activeRequest.current) return;
    void queryClient.cancelQueries({ queryKey: queryKeys.sshCredentials(sshHost) });
    const controller = new AbortController();
    activeRequest.current = controller;
    setState({ targetId, phase });
    try {
      const pending = request(controller.signal);
      // 同步抹除 DOM 中的密码，完成清理后才等待结果或触发上层操作。
      clearPassword();
      const status = await pending;
      if (!controller.signal.aborted) {
        if (status) queryClient.setQueryData(queryKeys.sshCredentials(sshHost), status);
        setState({ targetId, phase: success });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({ targetId, phase: 'error', message: sshErrorMessage(error, authMode) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.sshCredentials(sshHost) });
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
    if (authMode === 'password' && !passwordInput.current?.value && !saved) {
      setState({ targetId, phase: 'error', message: '请先输入 SSH 密码，再测试连接。' });
      passwordInput.current?.focus();
      return;
    }
    await runRequest(
      (signal) =>
        api
          .connectSsh(
            authMode === 'password'
              ? { sshHost, remoteDir, authMode, password: passwordInput.current?.value || undefined, savePassword }
              : { sshHost, remoteDir, authMode },
            signal,
          )
          .then((result) => {
            if (result.connected !== true || result.authMode !== authMode) {
              throw new ApiError(502, '连接接口返回了无效状态', undefined, 'protocol_error');
            }
            return result;
          }),
      'connecting',
      'verified',
    );
  };

  const disconnect = () =>
    runRequest(
      async (signal) => {
        await api.disconnectSsh(sshHost, signal);
        return api.sshCredentials(sshHost, signal);
      },
      'disconnecting',
      'disconnected',
    );

  const changeSaving = (save: boolean) => {
    if (!save && saved) {
      void runRequest((signal) => api.clearSavedSshPassword(sshHost, signal), 'updating', 'disconnected');
      // 先保留已保存状态；只有接口成功，复选框才跟随返回值取消。
      setPreference(undefined);
    } else {
      setPreference({ targetId, save });
      setState({ targetId, phase: 'idle' });
    }
  };

  return {
    ...feedbackState(current, credentials.data?.paused === true, credentials.error, authMode),
    busy,
    verified: current.phase === 'verified',
    hasPassword,
    saved,
    savePassword,
    savingAvailable: credentials.data?.savingAvailable === true,
    loadingCredentials: credentials.isFetching,
    changeSaving,
    passwordRef,
    passwordChanged,
    clearPassword,
    focusPassword: () => passwordInput.current?.focus(),
    reset,
    connect,
    disconnect,
  };
}
