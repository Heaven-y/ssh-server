import { useEffect, useRef, useState } from 'react';
import type { AgentKind, ModelSettingField, NativeModelSettingsDocument } from '@agentdeck/shared';
import { confirmNativeDiscard, nativeSettingsError } from './native-resource-labels';
import { invalidateNativeCapabilities, modelSettingsApi } from './model-settings-api';

export type ModelSettingsDraft = Record<string, string | null>;
export type SettingsLeave = (action: () => void) => void;

export function modelSettingsFields(document: NativeModelSettingsDocument, draft: ModelSettingsDraft) {
  const selected = draft.provider ?? document.fields.find((field) => field.key === 'provider')?.value;
  return [...document.fields, ...(document.providers?.find((provider) => provider.id === selected)?.fields ?? [])];
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
  if (field.key === 'authMode') {
    delete next.apiKey;
    delete next.envKey;
  }
  // 密码输入留空表示保留；删除必须使用单独的清除操作。
  if (value === field.value || (field.secret && value === '')) delete next[field.key];
  else next[field.key] = value;
  return next;
}

export function useModelSettings(agent: AgentKind) {
  const [document, setDocument] = useState<NativeModelSettingsDocument>();
  const [draft, setDraft] = useState<ModelSettingsDraft>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const pending = useRef<AbortController | undefined>(undefined);
  const lock = useRef(false);
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
  const leave: SettingsLeave = (action) => {
    if (lock.current || !confirmNativeDiscard(dirty)) return;
    pending.current?.abort();
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
    if (!document || !dirty || lock.current) return;
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
      if (controller.signal.aborted) return;
      setDocument(result);
      setDraft({});
      setMessage('已保存到原生配置，新启动的会话会读取。');
    } catch (reason) {
      if (!controller.signal.aborted) setError(nativeSettingsError(reason));
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setSaving(false);
    }
  };
  return { document, draft, dirty, error, message, saving, leave, reread, change, save };
}
