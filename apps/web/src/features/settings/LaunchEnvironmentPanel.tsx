import { settingsApi } from './api';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import type { AgentKind } from '@agentdeck/shared/conversation';
import type { LaunchEnvironmentDocument } from '@agentdeck/shared/settings';

import { buttonClass } from '../../ui/styles';
import { SettingsDetailDialog } from './SettingsDetailDialog';
import { confirmNativeDiscard, nativeAgentNames, nativeSettingsError } from './native-resource-labels';
import { invalidateNativeCapabilities } from '../../cli/shared/capability-cache';
import {
  LaunchEnvironmentVariable,
  invalidLaunchDraft,
  type LaunchDraft,
  type LaunchVariable,
  type LaunchVariableDraft,
} from './LaunchEnvironmentVariable';

function useLaunchEnvironment(agent: AgentKind) {
  const [document, setDocument] = useState<LaunchEnvironmentDocument>();
  const [draft, setDraft] = useState<LaunchDraft>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [operation, setOperation] = useState<'save' | 'restart'>();
  const [reload, setReload] = useState(0);
  const pending = useRef<AbortController | undefined>(undefined);
  const lock = useRef(false);
  const dirty = Object.keys(draft).length > 0;
  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    void settingsApi
      .readLaunchEnvironment(agent, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setDocument(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(nativeSettingsError(reason));
      });
    return () => pending.current?.abort();
  }, [agent, reload]);
  const clear = () => {
    pending.current?.abort();
    setDocument(undefined);
    setDraft({});
    setError('');
    setMessage('');
  };
  const leave = (action: () => void) => {
    if (lock.current || !confirmNativeDiscard(dirty)) return;
    clear();
    action();
  };
  const change = (variable: LaunchVariable, patch: Partial<LaunchVariableDraft>) => {
    setMessage('');
    setDraft((current) => {
      const next = { mode: variable.mode, value: '', ...current[variable.name], ...patch };
      const updated = { ...current };
      if (next.mode === variable.mode && !next.value) delete updated[variable.name];
      else updated[variable.name] = next;
      return updated;
    });
  };
  const perform = async (action: 'save' | 'restart', execute: (signal: AbortSignal) => Promise<string>) => {
    if (lock.current) return;
    lock.current = true;
    setOperation(action);
    setError('');
    setMessage('');
    const controller = new AbortController();
    pending.current = controller;
    try {
      const result = await execute(controller.signal);
      if (!controller.signal.aborted) setMessage(result);
    } catch (reason) {
      if (!controller.signal.aborted) setError(nativeSettingsError(reason));
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setOperation(undefined);
    }
  };
  const save = async () => {
    if (!document || invalidLaunchDraft(document, draft)) return;
    await perform('save', async (signal) => {
      const variables = Object.entries(draft).map(([name, value]) => ({
        name,
        mode: value.mode,
        ...(value.mode === 'set' && value.value ? { value: value.value } : {}),
      }));
      const result = await settingsApi.saveLaunchEnvironment(agent, { revision: document.revision, variables }, signal);
      await invalidateNativeCapabilities(agent);
      if (!signal.aborted) {
        setDocument(result);
        setDraft({});
      }
      return '启动环境已保存，新启动使用新配置；已有会话可点击“重新启动 CLI”后继续发送。';
    });
  };
  const restart = async () => {
    if (!document || dirty) return;
    await perform('restart', async (signal) => {
      await settingsApi.restartAgentRuntime(agent, signal);
      return '下一次发送时将重新启动 CLI 并使用当前启动环境。';
    });
  };
  return {
    document,
    draft,
    dirty,
    error,
    message,
    operation,
    leave,
    change,
    save,
    restart,
    reread: () => leave(() => setReload((value) => value + 1)),
  };
}
type LaunchState = ReturnType<typeof useLaunchEnvironment>;

export default function LaunchEnvironmentPanel({
  agent,
  onBack,
  onClose,
}: {
  agent: AgentKind;
  onBack(): void;
  onClose(): void;
}) {
  const state = useLaunchEnvironment(agent);
  return (
    <SettingsDetailDialog
      title={`CLI 环境变量 · ${nativeAgentNames[agent]}`}
      busy={!!state.operation}
      onBack={() => state.leave(onBack)}
      onClose={() => state.leave(onClose)}
      footer={<LaunchFooter state={state} />}
    >
      <LaunchContent state={state} />
    </SettingsDetailDialog>
  );
}

function LaunchFooter({ state }: { state: LaunchState }) {
  const canSave = !!state.document && state.dirty && !invalidLaunchDraft(state.document, state.draft);
  return (
    <>
      <p className="text-xs text-muted-foreground">{state.dirty ? '有未保存修改' : '对工作台新会话生效'}</p>
      <button
        type="button"
        className={buttonClass('primary')}
        disabled={!!state.operation || !canSave}
        onClick={() => void state.save()}
      >
        <Save aria-hidden className="size-4" />
        {state.operation === 'save' ? '正在保存…' : '保存环境变量'}
      </button>
    </>
  );
}

function LaunchContent({ state }: { state: LaunchState }) {
  const busy = !!state.operation;
  const loading = !state.document && !state.error;
  return (
    <>
      <p className="text-xs leading-6 text-muted-foreground">
        这里的变量仅传给工作台启动的 CLI，用于需要环境变量的代理、认证等高级配置。
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass('outline')} disabled={busy || loading} onClick={state.reread}>
          <RefreshCw aria-hidden className="size-4" />
          重新读取环境变量
        </button>
        <button
          type="button"
          className={buttonClass('outline')}
          disabled={busy || state.dirty || !state.document}
          onClick={() => void state.restart()}
        >
          {state.operation === 'restart' ? '正在重新启动…' : '重新启动 CLI'}
        </button>
      </div>
      {loading && (
        <p role="status" className="py-8 text-center text-sm text-muted-foreground">
          正在读取环境变量…
        </p>
      )}
      {state.document && (
        <LaunchVariables document={state.document} draft={state.draft} disabled={busy} change={state.change} />
      )}
      <LaunchFeedback error={state.error} message={state.message} />
    </>
  );
}
function LaunchFeedback({ error, message }: { error: string; message: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </>
  );
}

function LaunchVariables({
  document,
  draft,
  disabled,
  change,
}: {
  document: LaunchEnvironmentDocument;
  draft: LaunchDraft;
  disabled: boolean;
  change(variable: LaunchVariable, patch: Partial<LaunchVariableDraft>): void;
}) {
  const advanced =
    document.agent === 'antigravity'
      ? document.variables.filter((variable) => !['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL'].includes(variable.name))
      : [];
  const common = document.variables.filter((variable) => !advanced.includes(variable));
  const renderVariable = (variable: LaunchVariable) => (
    <LaunchEnvironmentVariable
      key={variable.name}
      variable={variable}
      draft={draft[variable.name]}
      encryptionAvailable={document.encryptionAvailable}
      disabled={disabled}
      change={(patch) => change(variable, patch)}
    />
  );
  return (
    <div className="space-y-3">
      <details className="text-xs leading-6 text-muted-foreground">
        <summary className="cursor-pointer">配置说明</summary>
        <p>{document.note}</p>
      </details>
      {!document.encryptionAvailable && (
        <p role="status" className="text-sm text-muted-foreground">
          本机加密不可用，无法保存新的密钥。仍可停用变量或恢复继承。
        </p>
      )}
      {common.map(renderVariable)}
      {advanced.length > 0 && (
        <details className="rounded-xl border border-border px-4 py-3">
          <summary className="cursor-pointer text-[13px] text-muted-foreground">ADC 与 Google Cloud（高级）</summary>
          {advanced.map(renderVariable)}
        </details>
      )}
      {document.variables.length === 0 && (
        <p className="text-sm text-muted-foreground">当前 CLI 没有已接入的附加启动变量，请使用其原生登录和配置入口。</p>
      )}
    </div>
  );
}
