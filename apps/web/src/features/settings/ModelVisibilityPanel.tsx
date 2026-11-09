import { useEffect, useRef, useState } from 'react';
import type { AgentKind, AgentModel } from '@agentdeck/shared/conversation';
import type { ProductSettingsDocument } from '@agentdeck/shared/settings';
import { queryClient } from '../../lib/query-client';
import { buttonClass, inputClass } from '../../ui/styles';
import { useChat } from '../chat/chat-store';
import { matchingModels } from '../chat/model-candidates';
import { modelDisplay } from '../../cli/shared/model-identity';
import { settingsApi, settingsKeys } from './api';
import { nativeSettingsError } from './native-resource-labels';

/** 只改本机产品偏好，保留各 CLI 的原生目录及默认模型。 */
function useModelVisibility(agent: AgentKind) {
  const [document, setDocument] = useState<ProductSettingsDocument>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const mounted = useRef(false);
  const lock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void settingsApi
      .readProductSettings(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setDocument(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(nativeSettingsError(reason));
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [agent, reload]);
  const visible = document?.settings.modelVisibility?.[agent];
  const save = async (ids?: string[]) => {
    if (!document || lock.current) return;
    lock.current = true;
    setSaving(true);
    setError('');
    const modelVisibility = { ...document.settings.modelVisibility };
    if (ids) modelVisibility[agent] = ids;
    else delete modelVisibility[agent];
    try {
      await settingsApi.saveProductSettings({
        revision: document.revision,
        settings: { ...document.settings, modelVisibility },
      });
      await queryClient.cancelQueries({ queryKey: settingsKeys.productSettings });
      // 保存响应可能晚于其他窗口的新修改；重读最新版本，不能发布旧快照。
      const result = await queryClient.fetchQuery({
        queryKey: settingsKeys.productSettings,
        queryFn: ({ signal }) => settingsApi.readProductSettings(signal),
        staleTime: 0,
      });
      useChat.getState().setDefaults(result.settings);
      if (mounted.current) setDocument(result);
    } catch (reason) {
      if (mounted.current) setError(nativeSettingsError(reason));
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return {
    visible,
    ready: !!document,
    saving,
    error,
    save,
    reload() {
      setDocument(undefined);
      setError('');
      setReload(reload + 1);
    },
  };
}

export function ModelVisibilityPanel({ agent, models }: { agent: AgentKind; models: AgentModel[] }) {
  const { visible, ready, saving, error, save, reload } = useModelVisibility(agent);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(50);
  const selected = new Set(visible ?? models.map((model) => model.id));
  const matches = matchingModels(models, query);
  return (
    <section aria-label="对话菜单中的模型" className="space-y-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[13px] font-medium">对话菜单中的模型</h4>
        <span role="status" className="text-xs text-muted-foreground">
          {saving ? '正在保存…' : '勾选后自动保存'}
        </span>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">选择日常使用的型号；当前会话使用的模型始终保留。</p>
      {models.length > 0 ? (
        <>
          <input
            aria-label="筛选模型显示列表"
            value={query}
            placeholder="搜索型号"
            className={inputClass}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(50);
            }}
          />
          <div className="max-h-56 overflow-y-auto rounded-lg border border-border p-1">
            {matches.slice(0, limit).map((model) => (
              <label
                key={model.id}
                className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-muted/60"
              >
                <input
                  type="checkbox"
                  aria-label={`显示 ${modelDisplay(model.id, model)}`}
                  checked={selected.has(model.id)}
                  disabled={!ready || saving}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(model.id);
                    else next.delete(model.id);
                    void save([...next]);
                  }}
                />
                <span className="min-w-0 truncate" title={model.id}>
                  {modelDisplay(model.id, model)}
                </span>
              </label>
            ))}
            {!matches.length && <p className="p-2 text-xs text-muted-foreground">没有匹配的模型</p>}
            {matches.length > limit && (
              <button type="button" className={buttonClass('ghost')} onClick={() => setLimit(limit + 50)}>
                显示更多
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass('ghost')}
              disabled={!ready || saving}
              onClick={() => void save([])}
            >
              全部隐藏
            </button>
            <button
              type="button"
              className={buttonClass('ghost')}
              disabled={!ready || saving || visible === undefined}
              onClick={() => void save()}
            >
              恢复全部模型
            </button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">获取模型后可选择显示范围。</p>
      )}
      {error && (
        <div className="text-xs text-destructive-foreground">
          <p role="alert">{error}</p>
          <button type="button" className={buttonClass('ghost')} disabled={saving} onClick={reload}>
            重新读取显示设置
          </button>
        </div>
      )}
    </section>
  );
}
