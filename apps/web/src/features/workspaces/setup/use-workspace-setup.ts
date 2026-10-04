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
import { useSshConnection } from '../../ssh/use-ssh-connection';
import { useCancelableRequest } from './use-cancelable-request';

export const SETUP_STEPS = ['本地副本', '服务器认证', '远端目录', '同步规则', '确认创建'] as const;
const EMPTY: WorkspaceInput = {
  name: '',
  localDir: '',
  sshHost: '',
  remoteDir: '~',
  authMode: 'key',
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
  const [input, setInput] = useState(EMPTY);
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
  const connection = useSshConnection({
    sshHost: input.sshHost,
    authMode: input.authMode ?? 'key',
    remoteDir: input.remoteDir,
  });
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
        connection.clearPassword();
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
    request.abort();
    revoke();
    setPreview(undefined);
    setMessage(undefined);
    if ('sshHost' in patch || 'authMode' in patch || 'remoteDir' in patch) connection.reset();
    setInput((current) => ({ ...current, ...patch }));
  };
  const navigate = (next: number) => {
    if (create.isPending) return;
    if (next > step) {
      const error = stepError(step, input, connection.verified, syncDirty);
      if (error) {
        setMessage(error);
        return;
      }
    }
    request.abort();
    revoke();
    connection.clearPassword();
    setMessage(undefined);
    if (step === 3 && next < step) setSyncDirty(false);
    setStep(next);
  };
  const verify = async () => {
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
    setPreview(undefined);
    const value = await request.run((signal) => api.previewWorkspace(input, signal));
    if (value) setPreview(value);
  };
  const submit = () => {
    if (create.isPending || !ticket || !confirmed) return;
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
    connection.reset();
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
    connection,
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
  };
}
function stepError(step: number, input: WorkspaceInput, verified: boolean, syncDirty: boolean) {
  if (step === 0 && (!input.name.trim() || !input.localDir)) return '请填写名称并选择本地目录';
  if (step === 1 && !verified) return '请先测试当前服务器的认证与连接';
  if (step === 2 && !WorkspaceSetupInputSchema.shape.remoteDir.safeParse(input.remoteDir).success)
    return '服务器目录须以 / 或 ~/ 开头';
  if (step === 3 && syncDirty) return '请先应用修改后的同步规则';
  return undefined;
}
