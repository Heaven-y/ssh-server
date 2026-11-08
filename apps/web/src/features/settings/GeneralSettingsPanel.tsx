import { settingsApi, settingsKeys } from './api';
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import type { ProductSettingsDocument } from '@agentdeck/shared/settings';

import { queryClient } from '../../lib/query-client';
import { buttonClass } from '../../ui/styles';
import { ProductSettingsForm } from './ProductSettingsForm';
import { parseSettingsDraft, settingsDraft, type ProductSettingsDraft } from './product-settings-draft';
import { nativeSettingsError } from './native-resource-labels';
import type { SettingsLeave } from './use-model-settings';
import { AppearanceSettings } from './AppearanceSettings';

function useGeneralSettings() {
  const [document, setDocument] = useState<ProductSettingsDocument>();
  const [draft, setDraft] = useState<ProductSettingsDraft>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const pending = useRef<AbortController | undefined>(undefined);
  const lock = useRef(false);
  const dirty = !!document && JSON.stringify(draft) !== JSON.stringify(settingsDraft(document.settings));
  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    void settingsApi
      .readProductSettings(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setDocument(result);
        setDraft(settingsDraft(result.settings));
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(nativeSettingsError(reason));
      });
    return () => pending.current?.abort();
  }, [reload]);
  const leave: SettingsLeave = (action) => {
    if (lock.current || (dirty && !window.confirm('产品设置有未保存修改，确定放弃吗？'))) return;
    action();
  };
  const reread = () =>
    leave(() => {
      setDocument(undefined);
      setDraft(undefined);
      setError('');
      setMessage('');
      setReload((value) => value + 1);
    });
  const save = async () => {
    if (!document || !draft || lock.current) return;
    const parsed = parseSettingsDraft(draft);
    if (!parsed.success) {
      setError('请检查设置中的字段。');
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    lock.current = true;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await settingsApi.saveProductSettings(
        { settings: parsed.data, revision: document.revision },
        controller.signal,
      );
      await queryClient.cancelQueries({ queryKey: settingsKeys.productSettings });
      queryClient.setQueryData(settingsKeys.productSettings, result);
      if (controller.signal.aborted) return;
      setDocument(result);
      setDraft(settingsDraft(result.settings));
      setMessage('产品设置已保存到本机。');
    } catch (reason) {
      if (!controller.signal.aborted) setError(nativeSettingsError(reason));
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setSaving(false);
    }
  };
  return { document, draft, setDraft, dirty, error, message, saving, leave, reread, save };
}

function GeneralFeedback({ state }: { state: ReturnType<typeof useGeneralSettings> }) {
  return (
    <>
      {!state.document && !state.error && (
        <p role="status" className="py-12 text-center text-sm text-muted-foreground">
          正在读取产品设置…
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      )}
    </>
  );
}

export function GeneralSettingsPanel({ guardRef }: { guardRef: MutableRefObject<SettingsLeave> }) {
  const state = useGeneralSettings();
  useLayoutEffect(() => {
    guardRef.current = state.leave;
    return () => {
      guardRef.current = (action) => action();
    };
  });
  return (
    <div className="space-y-6">
      <header>
        <h3 className="text-lg font-semibold">通用设置</h3>
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">工作台的使用偏好保存在本机。</p>
      </header>
      <AppearanceSettings />
      <GeneralFeedback state={state} />
      {state.draft && (
        <ProductSettingsForm
          draft={state.draft}
          disabled={state.saving}
          change={(patch) => state.setDraft((current) => current && { ...current, ...patch })}
        />
      )}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          {state.dirty ? '有未保存修改' : '模型和认证在“模型与连接”中设置。'}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass('ghost')}
            disabled={state.saving || (!state.document && !state.error)}
            onClick={state.reread}
          >
            <RefreshCw aria-hidden className="size-3.5" />
            重新读取
          </button>
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={state.saving || !state.dirty}
            onClick={() => void state.save()}
          >
            <Save aria-hidden className="size-3.5" />
            {state.saving ? '正在保存…' : '保存设置'}
          </button>
        </div>
      </footer>
    </div>
  );
}
