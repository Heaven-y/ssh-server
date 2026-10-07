import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  SyncSettingsSchema,
  WorkspaceSetupInputSchema,
  type Workspace,
  type WorkspaceInput,
  type WorkspaceSetupVerification,
  type WorkspaceSetupPreview,
  type WorkspaceSetupResult,
  type WorkspaceSetupCreate,
} from '@ssh-server/shared';
import { api, queryKeys } from '../../../lib/api';
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
  const [ticket, setTicket] = useState<WorkspaceSetupVerification>();
  const [preview, setPreview] = useState<WorkspaceSetupPreview>();
  const [confirmed, setConfirmed] = useState(false);
  const [syncDirty, setSyncDirty] = useState(false);
  const [result, setResult] = useState<WorkspaceSetupResult>();
  const ticketRef = useRef<string | undefined>(undefined);
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
      if (mounted.current) {
        setMessage(error.message);
        setTicket(undefined);
        ticketRef.current = undefined;
        setConfirmed(false);
      }
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
  };
  const change = (patch: Partial<WorkspaceInput>) => {
    if ('sync' in patch && !defaultsReady) return;
    request.abort();
    revoke();
    setPreview(undefined);
    setMessage(undefined);
    setInput((current) => ({ ...current, ...patch }));
  };
  const navigate = (next: number) => {
    if (create.isPending) return;
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
  const verify = async () => {
    if (!defaultsReady) return;
    revoke();
    setMessage(undefined);
    const checked = WorkspaceSetupInputSchema.safeParse(input);
    if (!checked.success) {
      setMessage('请检查工作区名称、两端目录与服务器配置');
      return;
    }
    const checkedTicket = await request.run(async (signal) => {
      const verified = await api.verifyWorkspace(checked.data, signal);
      if (signal.aborted) void api.revokeWorkspaceVerification(verified.verification).catch(() => undefined);
      return verified;
    });
    if (checkedTicket) {
      setTicket(checkedTicket);
      ticketRef.current = checkedTicket.verification;
    }
  };
  const previewFiles = async () => {
    if (!defaultsReady) return;
    setPreview(undefined);
    const value = await request.run((signal) => api.previewWorkspace(input, signal));
    if (value) setPreview(value);
  };
  const submit = () => {
    if (create.isPending || !defaultsReady || !ticket || !confirmed) return;
    if (ticket.expiresAt <= Date.now()) {
      revoke();
      setMessage('验证已过期，请重新验证');
      return;
    }
    create.mutate({ input, verification: ticket.verification, initializationConfirmed: true });
  };
  const cancel = () => {
    if (create.isPending) return;
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
    syncDirty,
    setSyncDirty,
    defaultsReady,
    defaultsError: defaultsReady ? null : defaults.error,
    retryDefaults: defaults.refetch,
  };
}
function stepError(step: number, input: WorkspaceInput, syncDirty: boolean) {
  if (step === 0 && (!input.name.trim() || !input.localDir)) return '请填写名称并选择本地目录';
  if (step === 1 && !input.sshHost) return '请选择已保存的服务器';
  if (step === 2 && !WorkspaceSetupInputSchema.shape.remoteDir.safeParse(input.remoteDir).success)
    return '服务器目录须以 / 或 ~/ 开头';
  if (step === 3 && syncDirty) return '请先应用修改后的同步规则';
  return undefined;
}
