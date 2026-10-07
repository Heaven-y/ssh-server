import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  SyncSettingsSchema,
  WorkspaceSetupInputSchema,
  type Workspace,
  type ManagedServer,
  type WorkspaceInput,
  type WorkspaceSetupVerification,
  type WorkspaceSetupPreview,
  type WorkspaceSetupResult,
  type WorkspaceSetupCreate,
} from '@ssh-server/shared';
import { api, ApiError, queryKeys } from '../../../lib/api';
import { useCancelableRequest } from './use-cancelable-request';
import { useProductSettings } from '../../settings/use-product-settings';

export const SETUP_STEPS = ['本地副本', '选择服务器', '远端目录', '同步规则', '确认创建'] as const;
const EMPTY: WorkspaceInput = {
  name: '',
  localDir: '',
  sshHost: '',
  remoteDir: '~',
  sync: SyncSettingsSchema.parse({}),
};
export function useWorkspaceSetup({
  onCreated,
  onCancel,
  onBusyChange,
}: {
  onCreated(workspace: Workspace): void;
  onCancel(): void;
  onBusyChange?(busy: boolean): void;
}) {
  const qc = useQueryClient();
  const defaults = useProductSettings();
  const defaultsCopied = useRef(false);
  const [defaultsReady, setDefaultsReady] = useState(false);
  const [input, setInput] = useState(EMPTY);
  useEffect(() => {
    if (defaultsCopied.current || !defaults.isSuccess) return;
    defaultsCopied.current = true;
    setInput((current) => ({ ...current, sync: structuredClone(defaults.data.settings.syncDefaults) }));
    setDefaultsReady(true);
  }, [defaults.isSuccess, defaults.data]);
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [ticket, setTicket] = useState<WorkspaceSetupVerification>();
  const [preview, setPreview] = useState<WorkspaceSetupPreview>();
  const [confirmed, setConfirmed] = useState(false);
  const [syncDirty, setSyncDirty] = useState(false);
  const [result, setResult] = useState<WorkspaceSetupResult>();
  const ticketRef = useRef<string | undefined>(undefined);
  const submitting = useRef(false);
  const closed = useRef(false);
  const mounted = useRef(false);
  const request = useCancelableRequest();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (ticketRef.current) void api.revokeWorkspaceVerification(ticketRef.current).catch(() => undefined);
    };
  }, []);
  const create = useMutation({
    mutationFn: (input: WorkspaceSetupCreate) => api.createVerifiedWorkspace(input),
    onSuccess: async (created) => {
      await qc.invalidateQueries({ queryKey: queryKeys.workspaces });
      if (mounted.current) {
        setResult(created);
        setTicket(undefined);
        ticketRef.current = undefined;
      }
    },
    onError: (error) => {
      submitting.current = false;
      if (mounted.current && !closed.current) {
        if (error instanceof ApiError && error.code === 'setup_verification_expired') {
          void verify(ticket);
        } else {
          revoke();
          setMessage(error.message);
        }
      }
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  useEffect(() => {
    onBusyChange?.(create.isPending);
  }, [onBusyChange, create.isPending]);
  const revoke = () => {
    if (ticketRef.current) void api.revokeWorkspaceVerification(ticketRef.current).catch(() => undefined);
    ticketRef.current = undefined;
    setTicket(undefined);
    setConfirmed(false);
    setNotice(undefined);
  };
  const change = (patch: Partial<WorkspaceInput>) => {
    if (submitting.current || ('sync' in patch && !defaultsReady)) return;
    request.abort();
    revoke();
    setPreview(undefined);
    setMessage(undefined);
    setInput((current) => ({ ...current, ...patch }));
  };
  const navigate = (next: number) => {
    if (submitting.current) return;
    if (next >= 3 && !defaultsReady) {
      setMessage('请先读取产品同步默认设置');
      return;
    }
    if (next > step) {
      const error = stepError(step, input, syncDirty);
      if (error) {
        setMessage(error);
        return;
      }
    }
    request.abort();
    revoke();
    setMessage(undefined);
    if (step === 3 && next < step) setSyncDirty(false);
    setStep(next);
  };
  const verify = async (previous?: WorkspaceSetupVerification) => {
    if (!defaultsReady || submitting.current || closed.current) return;
    revoke();
    setMessage(undefined);
    if (previous) setNotice('正在重新验证；草稿已保留。');
    const checked = WorkspaceSetupInputSchema.safeParse(input);
    if (!checked.success) {
      setMessage('请检查工作区名称、两端目录与服务器配置');
      return;
    }
    const checkedTicket = await request.run(async (signal) => {
      const verified = await api.verifyWorkspace(checked.data, signal, previous?.binding);
      if (signal.aborted) void api.revokeWorkspaceVerification(verified.verification).catch(() => undefined);
      return verified;
    });
    if (checkedTicket) {
      if (!canAcceptTicket(checkedTicket, previous)) {
        void api.revokeWorkspaceVerification(checkedTicket.verification).catch(() => undefined);
        setMessage('验证目标或状态已变化，未更改草稿。请检查目录与服务器档案，再手动验证并核对。');
        return;
      }
      if (previous) setNotice('已重新验证，请重新核对两端目录并确认创建。');
      setTicket(checkedTicket);
      ticketRef.current = checkedTicket.verification;
    }
  };
  // 定时器和点击提交共用同一撤票入口，旧定时器不能再启动第二次验证。
  const refreshExpired = useEffectEvent((previous: WorkspaceSetupVerification) => {
    if (ticketRef.current === previous.verification && !submitting.current) void verify(previous);
  });
  useEffect(() => {
    if (!ticket || create.isPending) return;
    const timer = setTimeout(() => refreshExpired(ticket), Math.max(0, ticket.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [ticket, create.isPending]);
  const invalidateServer = useEffectEvent(() => {
    if (submitting.current || closed.current) return;
    request.abort();
    revoke();
    setPreview(undefined);
    setMessage('服务器配置或认证已变化，请重新验证并核对目录。');
  });
  useEffect(() => {
    const hostKey = JSON.stringify(queryKeys.sshHosts);
    const credentialKey = JSON.stringify(queryKeys.sshCredentials(input.sshHost));
    const snapshot = () =>
      JSON.stringify([
        qc.getQueryData<ManagedServer[]>(queryKeys.sshHosts)?.find((server) => server.alias === input.sshHost),
        qc.getQueryData(queryKeys.sshCredentials(input.sshHost)),
      ]);
    let previous = snapshot();
    return qc.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      const key = JSON.stringify(event.query.queryKey);
      if (key !== hostKey && key !== credentialKey) return;
      const next = snapshot();
      if (next !== previous || (key === credentialKey && event.action.type === 'invalidate')) invalidateServer();
      previous = next;
    });
  }, [qc, input.sshHost]);
  const previewFiles = async () => {
    if (!defaultsReady) return;
    setPreview(undefined);
    const value = await request.run((signal) => api.previewWorkspace(input, signal));
    if (value) setPreview(value);
  };
  const submit = () => {
    if (
      submitting.current ||
      closed.current ||
      !defaultsReady ||
      !ticket ||
      !confirmed ||
      ticketRef.current !== ticket.verification
    )
      return;
    if (ticket.expiresAt <= Date.now()) {
      void verify(ticket);
      return;
    }
    submitting.current = true;
    create.mutate({ input, verification: ticket.verification, initializationConfirmed: true });
  };
  const cancel = () => {
    if (submitting.current) return;
    closed.current = true;
    request.abort();
    revoke();
    onCancel();
  };
  const finish = () => {
    if (result) onCreated(result.workspace);
  };
  return {
    input,
    change,
    step,
    navigate,
    ticket,
    confirmed,
    setConfirmed,
    preview,
    previewFiles,
    verify,
    submit,
    cancel,
    finish,
    result,
    creating: create.isPending,
    busy: request.busy,
    message: message ?? request.error,
    notice: request.error || message ? undefined : notice,
    syncDirty,
    setSyncDirty,
    defaultsReady,
    defaultsError: defaultsReady ? null : defaults.error,
    retryDefaults: defaults.refetch,
  };
}
function canAcceptTicket(ticket: WorkspaceSetupVerification, previous?: WorkspaceSetupVerification) {
  return ticket.expiresAt > Date.now() && (!previous || sameTarget(previous, ticket));
}
function sameTarget(a: WorkspaceSetupVerification, b: WorkspaceSetupVerification) {
  return (
    a.local.path === b.local.path &&
    a.remote.path === b.remote.path &&
    a.target.sshHost === b.target.sshHost &&
    a.target.authMode === b.target.authMode
  );
}
function stepError(step: number, input: WorkspaceInput, syncDirty: boolean) {
  if (step === 0 && (!input.name.trim() || !input.localDir)) return '请填写名称并选择本地目录';
  if (step === 1 && !input.sshHost) return '请选择已保存的服务器';
  if (step === 2 && !WorkspaceSetupInputSchema.shape.remoteDir.safeParse(input.remoteDir).success)
    return '服务器目录须以 / 或 ~/ 开头';
  if (step === 3 && syncDirty) return '请先应用修改后的同步规则';
  return undefined;
}
