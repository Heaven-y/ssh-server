import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { RefreshCw, Save, Settings2, X } from 'lucide-react';
import type { ProductSettingsDocument } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { queryClient } from '../../lib/query-client';
import { buttonClass } from '../../ui/styles';
import { ProductSettingsForm, invalidSettingsCategory } from './ProductSettingsForm';
import { EnvironmentReport } from './EnvironmentReport';
import { parseSettingsDraft, settingsDraft, type ProductSettingsDraft } from './product-settings-draft';
import { SettingsCategories, type SettingsCategory } from './SettingsCategories';

type Phase = 'loading' | 'ready' | 'saving' | 'error';
const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
function SettingsFeedback({ phase, message }: { phase: Phase; message: string }) {
  if (!message) return null;
  return (
    <p
      role={phase === 'error' ? 'alert' : 'status'}
      className={`text-sm ${phase === 'error' ? 'text-destructive-foreground' : 'text-muted-foreground'}`}
    >
      {message}
    </p>
  );
}
function focusInvalidField(dialog: HTMLDialogElement | null) {
  const field = dialog?.querySelector<HTMLElement>('[aria-invalid="true"]');
  field?.focus();
  return !!field;
}
export default function ProductSettingsDialog({ onClose, onNative }: { onClose(): void; onNative(): void }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<AbortController | undefined>(undefined);
  const saving = useRef(false);
  const focusInvalid = useRef(false);
  const [category, setCategory] = useState<SettingsCategory>('conversation');
  const [document, setDocument] = useState<ProductSettingsDocument>();
  const [draft, setDraft] = useState<ProductSettingsDraft>();
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const dirty = !!document && JSON.stringify(draft) !== JSON.stringify(settingsDraft(document.settings));
  const busy = phase === 'saving' || phase === 'loading';
  useLayoutEffect(() => {
    if (!focusInvalid.current) return;
    if (focusInvalidField(dialog.current)) focusInvalid.current = false;
  });
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    void api
      .readProductSettings(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setDocument(result);
        setDraft(settingsDraft(result.settings));
        setPhase('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setMessage(errorMessage(error, '产品设置读取失败，请重试。'));
        setPhase('error');
      });
    return () => pending.current?.abort();
  }, [reload]);
  const leave = (action: () => void) => {
    if (saving.current || (dirty && !window.confirm('产品设置有未保存修改，确定放弃吗？'))) return;
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
  const save = async () => {
    if (!document || !draft || busy || saving.current) return;
    const parsed = parseSettingsDraft(draft);
    setShowErrors(true);
    if (!parsed.success) {
      focusInvalid.current = true;
      setCategory(invalidSettingsCategory(draft));
      focusInvalidField(dialog.current);
      setMessage('请检查标出的字段。');
      return;
    }
    saving.current = true;
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    setPhase('saving');
    setMessage('');
    try {
      const result = await api.saveProductSettings(
        { settings: parsed.data, revision: document.revision },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      await queryClient.cancelQueries({ queryKey: queryKeys.productSettings });
      setDocument(result);
      setDraft(settingsDraft(result.settings));
      setPhase('ready');
      setMessage('产品设置已保存到本机。');
      queryClient.setQueryData(queryKeys.productSettings, result);
    } catch (error) {
      if (controller.signal.aborted) return;
      setPhase('error');
      setMessage(errorMessage(error, '保存失败，修改已保留。'));
    } finally {
      saving.current = false;
    }
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        leave(onClose);
      }}
      className="m-auto w-[min(800px,calc(100vw-32px))] max-h-[calc(100vh-40px)] overflow-hidden rounded-lg border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/60"
    >
      <div className="flex max-h-[calc(100vh-40px)] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id={`${id}-title`} className="flex items-center gap-2 font-semibold">
            <Settings2 aria-hidden className="size-5" />
            产品设置
          </h2>
          <button
            type="button"
            className={buttonClass('ghost')}
            disabled={phase === 'saving'}
            aria-label="关闭设置"
            onClick={() => leave(onClose)}
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>
        <div className="space-y-5 overflow-y-auto p-5">
          <SettingsCategories category={category} select={setCategory}>
            {category === 'environment' ? (
              <EnvironmentReport disabled={phase === 'saving'} />
            ) : phase === 'loading' ? (
              <p role="status" className="py-8 text-center text-sm text-muted-foreground">
                正在读取产品设置…
              </p>
            ) : draft ? (
              <ProductSettingsForm
                category={category}
                draft={draft}
                disabled={phase === 'saving'}
                showErrors={showErrors}
                validate={() => setShowErrors(true)}
                change={(patch) => {
                  setDraft((current) => current && { ...current, ...patch });
                  setMessage('');
                }}
              />
            ) : null}
          </SettingsCategories>
          <SettingsFeedback phase={phase} message={message} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <button
              type="button"
              className={buttonClass('ghost')}
              disabled={phase === 'saving'}
              onClick={() => leave(onNative)}
            >
              编辑原生 Agent 配置
            </button>
            <button type="button" className={buttonClass('ghost')} disabled={busy} onClick={reread}>
              <RefreshCw aria-hidden className="size-4" />
              重新读取
            </button>
          </div>
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
          <p className="text-xs text-muted-foreground">
            {dirty ? '有未保存修改 · 保存所有分类' : '产品偏好保存在本机'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass('ghost')}
              disabled={phase === 'saving'}
              onClick={() => leave(onClose)}
            >
              关闭
            </button>
            <button
              type="button"
              className={buttonClass('primary')}
              disabled={busy || !dirty}
              onClick={() => void save()}
            >
              <Save aria-hidden className="size-4" />
              {phase === 'saving' ? '正在保存…' : '保存设置'}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
