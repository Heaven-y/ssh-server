import { useEffect, useRef, useState } from 'react';
import type { AgentCapabilities, AgentKind, ModelSettingField, NativeModelSettingsDocument } from '@agentdeck/shared';
import { confirmNativeDiscard, nativeSettingsError } from './native-resource-labels';
import { invalidateNativeCapabilities, modelSettingsApi } from './model-settings-api';
import { queryClient } from '../../lib/query-client';
import { queryKeys } from '../../lib/api';

export type ModelSettingsDraft = Record<string, string | null>;
export type SettingsLeave = (action: () => void) => void;
const modelFailure = (reason: unknown) => (reason instanceof Error ? reason.message : '暂时无法获取模型');
function publishCatalog(agent: AgentKind, result: AgentCapabilities, projectId?: string) {
  if (projectId) queryClient.setQueryData(queryKeys.agentCapabilities(projectId, agent), result);
  void queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'agent-capabilities' && query.queryKey[2] === agent,
  });
}
function emptyModelMessage(catalog?: AgentCapabilities) {
  return catalog?.discovered && !catalog.models.length ? '可直接填写模型 ID' : '';
}
const modelWarning = (catalog: AgentCapabilities) => catalog.modelWarning ?? '';

export function modelSettingsFields(document: NativeModelSettingsDocument, draft: ModelSettingsDraft) {
  const selected = draft.provider ?? document.fields.find((field) => field.key === 'provider')?.value;
  const fields = [
    ...document.fields,
    ...(document.providers?.find((provider) => provider.id === selected)?.fields ?? []),
  ];
  if (document.agent !== 'antigravity') return fields;
  const connection = draft.modelProvider ?? fields.find((field) => field.key === 'modelProvider')?.value;
  return connection === 'gemini'
    ? fields
    : fields.filter((field) => !['baseUrl', 'apiKey', 'displayName', 'contextWindow'].includes(field.key));
}
export function modelSettingValue(field: ModelSettingField, draft: ModelSettingsDraft) {
  return Object.hasOwn(draft, field.key) ? (draft[field.key] ?? '') : field.value;
}
function changedDraft(
  document: NativeModelSettingsDocument,
  draft: ModelSettingsDraft,
  field: ModelSettingField,
  value: string | null,
) {
  const next = { ...draft };
  if (field.key === 'provider') {
    for (const provider of document.providers ?? [])
      for (const connection of provider.fields) delete next[connection.key];
  }
  clearConnectionDraft(next, field.key);
  // 密码输入留空表示保留；删除必须使用单独的清除操作。
  if (value === field.value || (field.secret && value === '')) delete next[field.key];
  else next[field.key] = value;
  return next;
}
function clearConnectionDraft(draft: ModelSettingsDraft, field: string) {
  const fields =
    field === 'authMode'
      ? ['apiKey', 'envKey']
      : field === 'modelProvider'
        ? ['baseUrl', 'apiKey', 'displayName', 'contextWindow']
        : [];
  for (const key of fields) delete draft[key];
}

export function useModelSettings(agent: AgentKind, projectId?: string) {
  const [document, setDocument] = useState<NativeModelSettingsDocument>();
  const [draft, setDraft] = useState<ModelSettingsDraft>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const pending = useRef<AbortController | undefined>(undefined);
  const lock = useRef(false);
  const [modelCatalog, setModelCatalog] = useState<AgentCapabilities>();
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const catalogRequest = useRef<AbortController | undefined>(undefined);
  const dirty = Object.keys(draft).length > 0;
  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    void modelSettingsApi
      .read(agent, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setDocument(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(nativeSettingsError(reason));
      });
    return () => pending.current?.abort();
  }, [agent, reload]);
  useEffect(() => {
    const controller = new AbortController();
    catalogRequest.current = controller;
    void modelSettingsApi
      .catalog(agent, projectId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setModelCatalog(result);
      })
      .catch(() => undefined);
    return () => catalogRequest.current?.abort();
  }, [agent, projectId]);
  const leave: SettingsLeave = (action) => {
    if (lock.current || !confirmNativeDiscard(dirty)) return;
    pending.current?.abort();
    catalogRequest.current?.abort();
    setDraft({});
    action();
  };
  const reread = () =>
    leave(() => {
      setDocument(undefined);
      setError('');
      setMessage('');
      setReload((value) => value + 1);
    });
  const change = (field: ModelSettingField, value: string | null) => {
    if (!document || lock.current) return;
    setDraft((current) => changedDraft(document, current, field, value));
    setMessage('');
  };
  const save = async () => {
    if (!document || lock.current) return false;
    if (!dirty) return true;
    lock.current = true;
    setSaving(true);
    setError('');
    setMessage('');
    const controller = new AbortController();
    pending.current = controller;
    try {
      const result = await modelSettingsApi.save(
        agent,
        { revision: document.revision, changes: draft },
        controller.signal,
      );
      // 即使视图已离开，成功写入仍需清理公共能力缓存。
      await invalidateNativeCapabilities(agent);
      if (controller.signal.aborted) return false;
      setDocument(result);
      setDraft({});
      catalogRequest.current?.abort();
      setModelCatalog(undefined);
      setMessage('配置已保存');
      return true;
    } catch (reason) {
      if (!controller.signal.aborted) setError(nativeSettingsError(reason));
      return false;
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setSaving(false);
    }
  };
  const fetchModels = async () => {
    if (modelsLoading || lock.current) return;
    if (dirty && !(await save())) return;
    catalogRequest.current?.abort();
    const controller = new AbortController();
    catalogRequest.current = controller;
    setModelsLoading(true);
    setModelsError('');
    try {
      const result = await modelSettingsApi.refreshCatalog(agent, projectId, controller.signal);
      if (controller.signal.aborted) return;
      setModelCatalog(result);
      publishCatalog(agent, result, projectId);
      setModelsError(modelWarning(result));
    } catch (reason) {
      if (!controller.signal.aborted) setModelsError(modelFailure(reason));
    } finally {
      if (!controller.signal.aborted) setModelsLoading(false);
    }
  };
  return {
    document,
    draft,
    dirty,
    error,
    message,
    saving,
    leave,
    reread,
    change,
    save,
    modelCatalog,
    modelsLoading,
    modelsError,
    fetchModels,
    modelMessage: modelsError ? '' : emptyModelMessage(modelCatalog),
  };
}
