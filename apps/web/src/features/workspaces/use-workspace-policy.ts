import { useEffect, useId, useRef, useState } from 'react';
import { WorkspacePolicySchema, type WorkspacePolicy, type WorkspacePolicyDocument } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { queryClient } from '../../lib/query-client';

const draftOf = (policy: WorkspacePolicy): WorkspacePolicy => ({
  disabledRules: policy.disabledRules ?? [],
  customRules: policy.customRules ?? [],
});
const messageOf = (error: unknown) => (error instanceof Error ? error.message : '命令规则读写失败，请重试');
export function useWorkspacePolicy(workspaceId: string, onClose: () => void) {
  const prefix = useId();
  const summary = useRef<HTMLDivElement>(null);
  const pending = useRef<AbortController | undefined>(undefined);
  const saving = useRef(false);
  const [document, setDocument] = useState<WorkspacePolicyDocument>();
  const [draft, setDraft] = useState<WorkspacePolicy>();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const parsed = WorkspacePolicySchema.safeParse(draft);
  const errors =
    showErrors && !parsed.success
      ? parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
      : [];
  const dirty = !!document && JSON.stringify(draft) !== JSON.stringify(draftOf(document.policy));
  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    void api
      .readWorkspacePolicy(workspaceId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setDocument(result);
        setDraft(draftOf(result.policy));
        setPhase('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setMessage(messageOf(error));
        setPhase('error');
      });
    return () => pending.current?.abort();
  }, [workspaceId, reload]);
  useEffect(() => {
    if (showErrors) summary.current?.focus();
  }, [showErrors]);
  const leave = (action: () => void) => {
    if (saving.current || (dirty && !window.confirm('命令规则有未保存修改，确定放弃吗？'))) return;
    action();
  };
  const reread = () =>
    leave(() => {
      pending.current?.abort();
      setDocument(undefined);
      setDraft(undefined);
      setMessage('');
      setShowErrors(false);
      setPhase('loading');
      setReload((current) => current + 1);
    });
  const publish = async (result: WorkspacePolicyDocument, controller: AbortController) => {
    if (controller.signal.aborted) return;
    await queryClient.cancelQueries({ queryKey: queryKeys.workspaces });
    if (controller.signal.aborted) return;
    setDocument(result);
    setDraft(draftOf(result.policy));
    setShowErrors(false);
    setPhase('ready');
    setMessage('命令规则已保存，后续Agent远程执行将使用新规则。');
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
  };
  const busy = phase === 'saving' || phase === 'loading';
  const canSave = !!document && dirty && !busy;
  const save = async () => {
    if (!document || saving.current || busy) return;
    setShowErrors(true);
    if (!parsed.success) {
      summary.current?.focus();
      return;
    }
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    saving.current = true;
    setPhase('saving');
    setMessage('');
    try {
      const result = await api.saveWorkspacePolicy(
        workspaceId,
        { policy: parsed.data, revision: document.revision },
        controller.signal,
      );
      await publish(result, controller);
    } catch (error) {
      if (controller.signal.aborted) return;
      setPhase('error');
      setMessage(messageOf(error));
    } finally {
      saving.current = false;
    }
  };
  return {
    prefix,
    summary,
    draft,
    setDraft,
    phase,
    message,
    errors,
    busy,
    canSave,
    save,
    reread,
    close: () => leave(onClose),
  };
}
